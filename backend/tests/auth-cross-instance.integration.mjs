import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { sessionMaxAgeSeconds } from '../dist/auth/auth-policy.js'
import { sandbox } from './helpers/database.mjs'

test('real HTTP password rotation and logout revoke the old session across two API listeners', async () => {
  const db = await sandbox()
  const apps = []
  const origin = 'http://localhost:3000'
  const password = 'Virtual-cross-instance-password-123'
  try {
    await provisionAccounts(db.client, ['alice', 'bob'].map((loginName) => ({
      loginName, displayName: loginName, password
    })))
    const credentialsBefore = JSON.stringify(await db.client.accountCredential.findMany({ orderBy: { accountId: 'asc' } }))
    const endpoints = []
    for (let i = 0; i < 2; i++) {
      const app = await createApp(readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin }), false)
      apps.push(app)
      await app.listen(0, '127.0.0.1')
      endpoints.push(`http://127.0.0.1:${app.getHttpServer().address().port}`)
    }
    assert.notEqual(endpoints[0], endpoints[1])
    async function post(index, path, payload, cookie, csrf) {
      return fetch(endpoints[index] + path, {
        method: 'POST', headers: {
          origin, 'content-type': 'application/json',
          ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {})
        }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000)
      })
    }
    async function login(index, name, oldCookie) {
      const response = await post(index, '/api/auth/login', { loginName: name, password }, oldCookie)
      assert.equal(response.status, 200)
      const setCookie = response.headers.get('set-cookie')
      assert.ok(setCookie?.includes(`Max-Age=${sessionMaxAgeSeconds}`))
      const body = await response.json()
      assert.ok(typeof body.csrfToken === 'string')
      return { cookie: setCookie.split(';')[0], csrf: body.csrfToken, accountId: body.account.id }
    }
    async function sessionStatus(index, cookie) {
      const response = await post(index, '/api/auth/session', {}, cookie)
      await response.arrayBuffer()
      return response.status
    }
    const alice = await login(0, 'alice')
    const bob = await login(1, 'bob')
    const rotated = await login(1, 'alice', alice.cookie)
    assert.equal(rotated.accountId, alice.accountId)
    assert.ok(rotated.cookie !== alice.cookie, 'Rotation must issue a new cookie')
    assert.ok(rotated.csrf !== alice.csrf, 'Rotation must issue a new CSRF token')
    for (let i = 0; i < 2; i++) {
      assert.equal(await sessionStatus(i, alice.cookie), 401)
      assert.equal(await sessionStatus(i, rotated.cookie), 200)
      assert.equal(await sessionStatus(i, bob.cookie), 200)
    }
    const rejected = await post(0, '/api/auth/logout', {}, rotated.cookie, alice.csrf)
    assert.equal(rejected.status, 403)
    await rejected.arrayBuffer()
    assert.equal(await sessionStatus(1, rotated.cookie), 200)
    const wrongPassword = await post(0, '/api/auth/login', {
      loginName: 'alice', password: 'Virtual-wrong-password-456'
    })
    assert.equal(wrongPassword.status, 401)
    await wrongPassword.arrayBuffer()
    const logout = await post(0, '/api/auth/logout', {}, rotated.cookie, rotated.csrf)
    assert.equal(logout.status, 204)
    for (let i = 0; i < 2; i++) {
      assert.equal(await sessionStatus(i, rotated.cookie), 401)
      assert.equal(await sessionStatus(i, bob.cookie), 200)
    }
    const hashCookie = (cookie) => createHash('sha256').update(cookie.split('=')[1]).digest('hex')
    const sessions = await db.client.session.findMany()
    assert.equal(sessions.length, 3)
    for (const cookie of [alice.cookie, rotated.cookie]) {
      assert.ok(sessions.find((s) => s.tokenHash === hashCookie(cookie))?.revokedAt)
    }
    assert.ok(sessions.find((s) => s.tokenHash === hashCookie(bob.cookie))?.revokedAt === null)
    assert.equal(await db.client.account.count(), 2)
    const credentialsAfter = JSON.stringify(await db.client.accountCredential.findMany({ orderBy: { accountId: 'asc' } }))
    assert.ok(credentialsBefore === credentialsAfter, 'Authentication must not alter credentials')
  } finally {
    await Promise.all(apps.map((app) => app.close()))
    await db.close()
  }
})
