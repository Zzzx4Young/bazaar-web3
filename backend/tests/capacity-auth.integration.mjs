import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { sessionMaxAgeSeconds } from '../dist/auth/auth-policy.js'
import { capacityAuth } from '../scripts/capacity-auth.mjs'
import { capacityGateway } from '../scripts/capacity-gateway.mjs'
import { capacityAuthPolicy } from '../scripts/capacity-auth-policy.mjs'
import { readCapacityPolicy } from '../scripts/capacity-policy.mjs'
import { sandbox } from './helpers/database.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
test('capacity auth uses real scrypt passwords and audits real HTTP rotation and session rows', async () => {
  const sourceFiles = ['scripts/capacity-auth.mjs', 'scripts/capacity-auth-policy.mjs',
    'scripts/capacity-policy.mjs', 'scripts/capacity-gateway.mjs', 'dist/auth/password.js',
    'dist/auth/auth-policy.js', 'dist/auth/auth.service.js', 'dist/auth/auth.controller.js',
    'dist/auth/auth.guard.js', 'dist/config.js', 'dist/app.js', 'tests/capacity-auth.integration.mjs']
  const fingerprints = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async name =>
    [name, digest(await readFile(name))])))
  const sourceHashes = await fingerprints()
  const db = await sandbox(), apps = []
  let gateway
  const origin = 'http://localhost:3000'
  try {
    const policy = readCapacityPolicy({})
    const users = Array.from({ length: policy.users }, (_, i) => ({
      id: randomUUID(), loginName: `capacity-${i}`, displayName: `User${i}`, token: randomBytes(32).toString('base64url')
    }))
    await db.client.account.createMany({ data: users.map(({ id, loginName, displayName }) => ({ id, loginName, displayName })) })
    await db.client.session.createMany({ data: users.map(user => ({ accountId: user.id, tokenHash: digest(user.token),
      expiresAt: new Date(Date.now() + sessionMaxAgeSeconds * 1000) })) })
    const instances = []
    for (let i = 0; i < 2; i++) {
      const app = await createApp(readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
        TRUSTED_PROXY_CIDRS: capacityAuthPolicy.trustedProxyCidr }), false)
      apps.push(app); await app.listen(0, '127.0.0.1')
      instances.push({ port: app.getHttpServer().address().port, healthy: true })
    }
    async function post(port, path, payload, user) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie: `bazaar_session=${user.token}`,
          'x-csrf-token': digest(`csrf:${user.token}`), 'x-capacity-client': user.virtualClientId },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(policy.timeoutMs) })
      return { status: response.status, value: await response.json(), setCookie: response.headers.getSetCookie(),
        apiIndex: response.headers.has('x-capacity-api-index') ? Number(response.headers.get('x-capacity-api-index')) : undefined }
    }
    const auth = capacityAuth({ users, policy, post, instances,
      password: randomUUID(), registerSecret: () => {} })
    await auth.seed(db.client)
    gateway = await capacityGateway(instances, { virtualClients: auth.virtualClients })
    const port = gateway.server.address().port
    await auth.prepare(port)
    // Verify the gateway actually supplies distinct identities to the real
    // shared database limiter, rather than all actors consuming loopback quota.
    const expectedBuckets = [
      ...auth.virtualClients.values()
    ].map(ip => digest(`ip:${ip}`)).concat(
      auth.schedule.actorIndexes.map(index => digest(`login:${users[index].loginName}`))
    ).sort()
    const preparedBuckets = await db.client.authRateBucket.findMany({ orderBy: { key: 'asc' } })
    assert.deepEqual(preparedBuckets.map(bucket => bucket.key), expectedBuckets)
    assert.ok(preparedBuckets.every(bucket => bucket.count === 1))
    // Functional subset only: eight scheduled auth arrivals, no wall-clock500rps claim.
    for (let index = 0; index < policy.rate * 4; index++) if (auth.schedule.at(index)) await auth.send(index, port)
    const evidence = await auth.audit(db.client, 4)
    assert.equal(evidence.verified, true)
    assert.equal(evidence.preparedLogins, 32)
    assert.equal(evidence.loadLogins, 4); assert.equal(evidence.loadSessions, 4)
    assert.equal(evidence.verifiedActorSessions, 68); assert.equal(evidence.activeSessions, 1000)
    assert.equal(evidence.postLoadProbes, 136)
    assert.deepEqual(evidence.observedApiIndexes, [0, 1])
    assert.equal(gateway.stats.writeRetries, 0)
    await db.client.accountCredential.update({ where: { accountId: users[0].id }, data: { passwordHash: 'tampered' } })
    await assert.rejects(auth.audit(db.client, 4), /Authentication changed stored credentials/)
    assert.deepEqual(await fingerprints(), sourceHashes, 'Functional test sources changed during execution')
    await mkdir('.tmp', { recursive: true })
    await writeFile('.tmp/capacity-auth-functional-report.json', JSON.stringify({
      timestamp: new Date().toISOString(), verified: true,
      scope: 'functional auth subset; two HTTP listeners in one test process; no timed500rps load or HA fault',
      endpoints: instances.map(instance => `127.0.0.1:${instance.port}`),
      plannedAuthArrivals: auth.schedule.expectedCounts(4),
      evidence, tamperedCredentialRejected: true, sourceHashes
    }, null, 2) + '\n', { mode: 0o600 })
  } finally {
    await gateway?.close()
    await Promise.all(apps.map(app => app.close()))
    await db.close()
  }
})
