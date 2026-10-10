import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { hashPassword } from '../dist/auth/password.js'
import { sessionMaxAgeSeconds } from '../dist/auth/auth-policy.js'
import { capacityAuthSchedule } from './capacity-auth-policy.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
function requireSuccess(response, status = 200) {
  if (response.status !== status) {
    const error = new Error('Authentication HTTP response failed')
    error.code = `HTTP_${response.status}`
    throw error
  }
}

export function capacityAuth({ users, policy, post, instances, password, registerSecret }) {
  const schedule = capacityAuthSchedule(policy)
  const actors = schedule.actorIndexes.map(index => ({ user: users[index], index, busy: false }))
  assert.ok(actors.every(actor => actor.user))
  const byIndex = new Map(actors.map(actor => [actor.index, actor]))
  const virtualClients = new Map()
  for (const actor of actors) {
    registerSecret(actor.user.token)
    actor.user.virtualClientId = randomUUID()
    // RFC2544 benchmark identities; only the isolated test gateway may supply them.
    virtualClients.set(actor.user.virtualClientId, `198.18.${Math.floor(actor.index / 256)}.${actor.index % 256}`)
  }
  registerSecret(password)
  const issued = new Map(), revoked = new Map()
  const apiIndexes = new Set(), preparedApiIndexes = new Set(), loadApiIndexes = new Set()
  function recordApi(response, prepared = false) {
    if ([0, 1].includes(response.apiIndex)) {
      apiIndexes.add(response.apiIndex)
      const phaseIndexes = prepared ? preparedApiIndexes : loadApiIndexes
      phaseIndexes.add(response.apiIndex)
    }
  }
  const stats = { preparedLogins: 0, loadLogins: 0, loadSessions: 0, failures: 0, peakConcurrentPasswordLogins: 0,
    postLoadProbes: 0, preparationMs: 0 }
  let active = 0, credentialsBefore
  async function rotate(actor, port, prepared = false) {
    if (actor.busy) { stats.failures++; throw new Error('Overlapping authentication for one actor') }
    actor.busy = true
    const previous = actor.user.token
    const startedWallMs = Date.now()
    active++
    stats.peakConcurrentPasswordLogins = Math.max(stats.peakConcurrentPasswordLogins, active)
    try {
      const response = await post(port, '/api/auth/login', { loginName: actor.user.loginName, password }, actor.user)
      const finishedWallMs = Date.now()
      requireSuccess(response)
      recordApi(response, prepared)
      assert.ok(response.value.account?.id === actor.user.id, 'Authentication returned another account')
      const cookies = response.setCookie
      assert.ok(Array.isArray(cookies) && cookies.length === 1, 'Authentication cookie missing')
      const token = /^bazaar_session=([A-Za-z0-9_-]{43});/.exec(cookies[0])?.[1]
      assert.ok(token && cookies[0].includes(`Max-Age=${sessionMaxAgeSeconds}`), 'Invalid issued session cookie')
      assert.ok(response.value.csrfToken === digest(`csrf:${token}`), 'Invalid issued CSRF token')
      assert.ok(actor.user.token === previous, 'Actor session changed before rotation completed')
      assert.ok(token !== previous && !issued.has(digest(token)), 'Session token was reused')
      registerSecret(token)
      revoked.set(digest(previous), { actor, token: previous })
      issued.set(digest(token), { accountId: actor.user.id, startedWallMs, finishedWallMs })
      actor.user.token = token
      stats[prepared ? 'preparedLogins' : 'loadLogins']++
    } catch (error) { stats.failures++; throw error }
    finally { active--; actor.busy = false }
  }
  return {
    schedule, virtualClients,
    async seed(client) {
      const data = []
      for (const actor of actors) {
        const passwordHash = await hashPassword(password)
        registerSecret(passwordHash)
        data.push({ accountId: actor.user.id, passwordHash })
      }
      await client.accountCredential.createMany({ data })
      credentialsBefore = JSON.stringify(await client.accountCredential.findMany({ orderBy: { accountId: 'asc' } }))
    },
    async prepare(port) {
      const started = performance.now()
      for (const actor of actors) await rotate(actor, port, true)
      stats.preparationMs = performance.now() - started
    },
    async send(index, port) {
      const action = schedule.at(index)
      assert.ok(action, 'Not an authentication arrival')
      const actor = byIndex.get(action.userIndex)
      if (action.operation === 'login') return rotate(actor, port)
      const token = actor.user.token
      try {
        const response = await post(port, '/api/auth/session', {}, actor.user)
        requireSuccess(response)
        recordApi(response)
        assert.ok(response.value.account?.id === actor.user.id, 'Session returned another account')
        assert.ok(response.value.csrfToken === digest(`csrf:${token}`), 'Session CSRF mismatch')
        stats.loadSessions++
      } catch (error) { stats.failures++; throw error }
    },
    summary() { return { ...stats, actors: actors.length, issuedSessions: issued.size,
      observedApiIndexes: [...apiIndexes].sort(),
      preparedApiIndexes: [...preparedApiIndexes].sort(), loadApiIndexes: [...loadApiIndexes].sort(),
      seededSessions: users.length, virtualIdentityScope: 'isolated loopback proxy; synthetic benchmark IPs' } },
    async audit(client, seconds) {
      const expected = schedule.expectedCounts(seconds)
      assert.equal(stats.failures, 0, 'Authentication workload had failures')
      assert.equal(stats.preparedLogins, actors.length)
      assert.equal(stats.loadLogins, expected.login)
      assert.equal(stats.loadSessions, expected.session)
      assert.deepEqual([...loadApiIndexes].sort(), [0, 1], 'Measured authentication did not reach both API indexes')
      for (const { actor, token } of revoked.values()) for (const instance of instances) {
        const response = await post(instance.port, '/api/auth/session', {}, { ...actor.user, token })
        stats.postLoadProbes++
        requireSuccess(response, 401)
      }
      for (const actor of actors) for (const instance of instances) {
        const response = await post(instance.port, '/api/auth/session', {}, actor.user)
        stats.postLoadProbes++
        requireSuccess(response)
        assert.ok(response.value.account?.id === actor.user.id)
      }
      const rows = await client.session.findMany({ where: { accountId: { in: actors.map(a => a.user.id) } } })
      assert.equal(rows.length, actors.length + issued.size)
      for (const row of rows) {
        const mint = issued.get(row.tokenHash)
        if (mint) {
          assert.equal(row.accountId, mint.accountId)
          const ageMs = sessionMaxAgeSeconds * 1000
          assert.ok(mint.finishedWallMs >= mint.startedWallMs, 'Clock reversed during session issuance')
          assert.ok(row.expiresAt.getTime() >= mint.startedWallMs + ageMs &&
            row.expiresAt.getTime() <= mint.finishedWallMs + ageMs, 'Session lifetime differs from auth policy')
        } else assert.ok(revoked.has(row.tokenHash), 'Unexplained actor session')
        assert.equal(!!row.revokedAt, revoked.has(row.tokenHash))
      }
      assert.equal(await client.session.count(), users.length + issued.size)
      assert.equal(await client.session.count({ where: { revokedAt: null } }), users.length)
      assert.ok(credentialsBefore === JSON.stringify(await client.accountCredential.findMany({ orderBy: { accountId: 'asc' } })),
        'Authentication changed stored credentials')
      return { verified: true, verifiedActorSessions: rows.length, revokedSessions: revoked.size,
        activeSessions: users.length, credentialRowsUnchanged: true, expected, ...this.summary() }
    }
  }
}
