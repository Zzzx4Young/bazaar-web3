import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts, resetPassword } from '../dist/accounts/provision-accounts.js'
import { sandbox } from './helpers/database.mjs'

const password = 'Virtual-test-only-password-123'
const origin = 'http://localhost:3000'
const payload = { loginName: 'alice', password }
const cookieOf = (response) => response.headers['set-cookie'].split(';')[0]
const tokenHash = (cookie) => createHash('sha256').update(cookie.split('=')[1]).digest('hex')

test('I1: sessions, rotation, restart, revocation, CSRF and password reset over HTTP', async () => {
  const db = await sandbox()
  let app
  try {
    await provisionAccounts(db.client, [{ ...payload, displayName: 'Alice' }])
    const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin })
    app = await createApp(config, false)
    const login = (headers) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin, ...headers },
        payload
      })
    const response = await login()
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=43200/)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.deepEqual(Object.keys(response.json()).sort(), ['account', 'csrfToken'])
    assert.deepEqual(Object.keys(response.json().account).sort(), [
      'displayName',
      'id',
      'loginName'
    ])
    const oldCookie = cookieOf(response)
    const rotated = await login({ cookie: oldCookie })
    assert.equal(rotated.statusCode, 200)
    const cookie = cookieOf(rotated)
    const csrf = rotated.json().csrfToken
    assert.notEqual(cookie, oldCookie)
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin, 'content-type': 'application/json', cookie: oldCookie }, payload: {} })).statusCode,
      401
    )
    await app.close()
    app = await createApp(config, false)
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin, 'content-type': 'application/json', cookie }, payload: {} })).statusCode,
      200
    )
    for (const headers of [
      { cookie, 'x-csrf-token': csrf },
      { origin: 'https://attacker.invalid', cookie, 'x-csrf-token': csrf },
      { origin, cookie },
      { origin, cookie, 'x-csrf-token': '0'.repeat(64) }
    ]) {
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} }))
          .statusCode,
        403
      )
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin, 'content-type': 'application/json', cookie }, payload: {} })).statusCode,
        200
      )
    }
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin, cookie, 'x-csrf-token': csrf },
      payload: {}
    })
    assert.equal(logout.statusCode, 204)
    assert.match(logout.headers['set-cookie'], /Max-Age=0/)
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin, 'content-type': 'application/json', cookie }, payload: {} })).statusCode,
      401
    )
    const again = await login()
    assert.equal(again.statusCode, 200)
    await resetPassword(db.client, 'alice', 'Virtual-replacement-password-456')
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin, 'content-type': 'application/json', cookie: cookieOf(again) }, payload: {} }))
        .statusCode,
      401
    )
    assert.equal((await login()).statusCode, 401)
    assert.equal(await db.client.session.count({ where: { revokedAt: null } }), 0)
  } finally {
    await app?.close()
    await db.close()
  }
})

test('I1: invalid inputs, enumeration resistance, expiration, disabled accounts and rate limits', async () => {
  const db = await sandbox()
  let app
  try {
    await provisionAccounts(db.client, [{ ...payload, displayName: 'Alice' }])
    app = await createApp(
      readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: 'https://bazaar.example' }),
      false
    )
    const headers = { origin: 'https://bazaar.example' }
    const login = (input = payload) =>
      app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: input })
    assert.equal((await login({ ...payload, actorId: 'forged' })).statusCode, 400)
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload })).statusCode,
      403
    )
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { ...headers, 'content-type': 'text/plain' },
          payload: JSON.stringify(payload)
        })
      ).statusCode,
      415
    )
    const wrong = await login({ ...payload, password: 'Virtual-wrong-password-xxx' })
    const missing = await login({ ...payload, loginName: 'missing' })
    assert.equal(wrong.statusCode, 401)
    assert.equal(missing.statusCode, 401)
    assert.deepEqual(wrong.json(), missing.json())
    const response = await login()
    assert.equal(response.statusCode, 200)
    assert.match(response.headers['set-cookie'], /; Secure/)
    const cookie = cookieOf(response)
    // Backdate the session as well as expiry, preserving the DB lifetime constraint.
    await db.client.session.update({
      where: { tokenHash: tokenHash(cookie) },
      data: { createdAt: new Date(Date.now() - 10000), expiresAt: new Date(Date.now() - 1000) }
    })
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/session', headers: { ...headers, 'content-type': 'application/json', cookie }, payload: {} })).statusCode,
      401
    )
    const active = await login()
    assert.equal(active.statusCode, 200)
    await db.client.account.update({ where: { loginName: 'alice' }, data: { status: 'disabled' } })
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/session', headers: { ...headers, 'content-type': 'application/json', cookie: cookieOf(active) }, payload: {} }))
        .statusCode,
      401
    )
    assert.equal((await login()).statusCode, 401)
    assert.equal((await login()).statusCode, 401)
    const limited = await login()
    assert.equal(limited.statusCode, 429)
    assert.equal(limited.headers['retry-after'], '60')
    assert.equal(limited.body.includes(password), false)
  } finally {
    await app?.close()
    await db.close()
  }
})

test('I1: provisioning normalizes names and rolls back the whole batch on duplicates', async () => {
  const db = await sandbox()
  try {
    await provisionAccounts(db.client, [{ loginName: ' Alice ', displayName: 'Alice', password }])
    await assert.rejects(
      provisionAccounts(db.client, [
        { loginName: 'bob', displayName: 'Bob', password },
        { loginName: 'ALICE', displayName: 'Another Alice', password }
      ])
    )
    assert.equal(await db.client.account.count(), 1)
    assert.equal(await db.client.accountCredential.count(), 1)
    const stored = await db.client.accountCredential.findFirstOrThrow()
    assert.equal(stored.passwordHash.includes(password), false)
    assert.match(stored.passwordHash, /^scrypt\$v1\$131072\$8\$1\$/)
  } finally {
    await db.close()
  }
})
