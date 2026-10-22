import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { sandbox } from './helpers/database.mjs'

const origin = 'http://localhost:3000'
const password = 'Virtual-test-only-password-123'
const post = (app, path, payload, headers = {}) => app.inject({
  method: 'POST', url: `/api/auth/${path}`, headers: { origin, ...headers }, payload
})
const cookieOf = (response, name = 'bazaar_session') =>
  [response.headers['set-cookie']].flat().filter(Boolean)
    .map(value => value.split(';')[0]).find(part => part.startsWith(`${name}=`))

test('unconfigured email sender disables both request and verification without saving a challenge', async () => {
  const db = await sandbox()
  const app = await createApp(readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin }), false)
  try {
    for (const path of ['email/request', 'email/verify']) {
      const response = await post(app, path, path.endsWith('verify')
        ? { email: 'new@gmail.com', code: '123456' } : { email: 'new@gmail.com' })
      assert.equal(response.statusCode, 503, response.body)
      assert.equal(response.json().code, 'EMAIL_UNAVAILABLE')
    }
    assert.equal(await db.client.emailCodeChallenge.count(), 0)
  } finally { await app.close(); await db.close() }
})

test('email code creates a new account once, persists bad attempts, rotates session and rejects password-account login', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: { send: async message => { sent.push(message) } } })
  try {
    await provisionAccounts(db.client, [{ loginName: 'old@gmail.com', displayName: 'Old', password }])
    assert.equal((await post(app, 'email/request', { email: 'new@gmail.com', locale: 'zh-CN' })).statusCode, 202)
    assert.match(sent[0].code, /^\d{6}$/)
    const wrong = await post(app, 'email/verify', { email: 'new@gmail.com', code: '999999' })
    assert.equal(wrong.statusCode, 401, wrong.body)
    assert.equal((await db.client.emailCodeChallenge.findFirstOrThrow()).attempts, 1)
    const verified = await post(app, 'email/verify', { email: 'new@gmail.com', code: sent[0].code })
    assert.equal(verified.statusCode, 200, verified.body)
    assert.equal(verified.json().account.loginName, 'new@gmail.com')
    assert.equal(await db.client.accountIdentity.count({ where: { provider: 'email' } }), 1)
    assert.equal((await post(app, 'email/verify', { email: 'new@gmail.com', code: sent[0].code })).statusCode, 401)
    const oldCookie = cookieOf(verified)
    await db.client.emailCodeChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 120000) } })
    assert.equal((await post(app, 'email/request', { email: 'new@gmail.com' })).statusCode, 202)
    const again = await post(app, 'email/verify', { email: 'new@gmail.com', code: sent.at(-1).code }, { cookie: oldCookie })
    assert.equal(again.statusCode, 200, again.body)
    assert.notEqual(cookieOf(again), oldCookie)
    assert.equal((await post(app, 'session', {}, { cookie: oldCookie })).statusCode, 401)

    assert.equal((await post(app, 'email/request', { email: 'old@gmail.com' })).statusCode, 202)
    const conflict = await post(app, 'email/verify', { email: 'old@gmail.com', code: sent.at(-1).code })
    assert.equal(conflict.statusCode, 409, conflict.body)
    assert.equal(conflict.json().code, 'ACCOUNT_LINK_REQUIRED')
    assert.equal(await db.client.accountIdentity.count({ where: { subject: 'old@gmail.com' } }), 0)
  } finally { await app.close(); await db.close() }
})

test('Google callback uses sub identity, rejects automatic email merge, and supports explicit binding', async () => {
  const db = await sandbox()
  const profiles = new Map()
  const googleClient = {
    authorizeUrl: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange: async ({ code }) => profiles.get(code)
  }
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' })
  const app = await createApp(config, false, { googleClient })
  try {
    profiles.set('new', { sub: 'google-1', email: 'new@gmail.com', name: 'New' })
    const start = await post(app, 'google/start', { returnTo: '/zh-CN/me' })
    assert.equal(start.statusCode, 200, start.body)
    const state = new URL(start.json().authorizationUrl).searchParams.get('state')
    const attemptCookie = cookieOf(start, 'bazaar_google_state')
    const callback = await app.inject({ method: 'GET', url: `/api/auth/google/callback?state=${state}&code=new`, headers: { cookie: attemptCookie } })
    assert.equal(callback.statusCode, 302, callback.body)
    assert.equal(callback.headers.location, `${origin}/zh-CN/me`)
    assert.ok(cookieOf(callback))
    assert.equal((await db.client.accountIdentity.findFirstOrThrow({ where: { provider: 'google' } })).subject, 'google-1')
    assert.equal((await app.inject({ method: 'GET', url: `/api/auth/google/callback?state=${state}&code=new`, headers: { cookie: attemptCookie } })).statusCode, 302)
    assert.equal(await db.client.accountIdentity.count({ where: { provider: 'google' } }), 1)

    await provisionAccounts(db.client, [
      { loginName: 'old@gmail.com', displayName: 'Old', password },
      { loginName: 'other', displayName: 'Other', password }
    ])
    profiles.set('old', { sub: 'google-2', email: 'old@gmail.com', name: 'Old' })
    const oldStart = await post(app, 'google/start', {})
    const oldState = new URL(oldStart.json().authorizationUrl).searchParams.get('state')
    const conflict = await app.inject({ method: 'GET', url: `/api/auth/google/callback?state=${oldState}&code=old`, headers: { cookie: cookieOf(oldStart, 'bazaar_google_state') } })
    assert.match(conflict.headers.location, /ACCOUNT_LINK_REQUIRED/)
    assert.equal(await db.client.accountIdentity.count({ where: { subject: 'google-2' } }), 0)
    const otherLogin = await post(app, 'login', { loginName: 'other', password })
    const otherStart = await post(app, 'google/bind/start', { password }, {
      cookie: cookieOf(otherLogin), 'x-csrf-token': otherLogin.json().csrfToken
    })
    const otherState = new URL(otherStart.json().authorizationUrl).searchParams.get('state')
    const wrongBinding = await app.inject({ method: 'GET',
      url: `/api/auth/google/callback?state=${otherState}&code=old`,
      headers: { cookie: `${cookieOf(otherLogin)}; ${cookieOf(otherStart, 'bazaar_google_state')}` } })
    assert.match(wrongBinding.headers.location, /ACCOUNT_LINK_REQUIRED/)
    const passwordLogin = await post(app, 'login', { loginName: 'old@gmail.com', password })
    const cookie = cookieOf(passwordLogin)
    const csrf = passwordLogin.json().csrfToken
    const before = await app.inject({ method: 'GET', url: '/api/auth/identities', headers: { cookie } })
    assert.deepEqual(before.json(), { google: false, email: false, hasPassword: true })
    const bindStart = await post(app, 'google/bind/start', { password }, { cookie, 'x-csrf-token': csrf })
    assert.equal(bindStart.statusCode, 200, bindStart.body)
    const bindState = new URL(bindStart.json().authorizationUrl).searchParams.get('state')
    const bindCookie = cookieOf(bindStart, 'bazaar_google_state')
    const bound = await app.inject({ method: 'GET',
      url: `/api/auth/google/callback?state=${bindState}&code=old`,
      headers: { cookie: `${cookie}; ${bindCookie}` } })
    assert.equal(bound.statusCode, 302, bound.body)
    assert.equal(await db.client.accountIdentity.count({ where: { subject: 'google-2' } }), 1)
    assert.equal((await post(app, 'session', {}, { cookie })).statusCode, 401)
    const after = await app.inject({ method: 'GET', url: '/api/auth/identities',
      headers: { cookie: cookieOf(bound) } })
    assert.deepEqual(after.json(), { google: true, email: false, hasPassword: true })
  } finally { await app.close(); await db.close() }
})

test('Google starts are limited per IP across API instances before creating attempts', async () => {
  const db = await sandbox()
  const googleClient = {
    authorizeUrl: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange: async () => { throw new Error('unused') }
  }
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' })
  const apps = await Promise.all([createApp(config, false, { googleClient }),
    createApp(config, false, { googleClient })])
  try {
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) =>
      post(apps[index % 2], 'google/start', { returnTo: '/en/me' })))
    assert.deepEqual(responses.map(response => response.statusCode).sort(),
      [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429])
    assert.equal(responses.find(response => response.statusCode === 429).json().code, 'RATE_LIMITED')
    assert.equal(await db.client.googleOAuthAttempt.count(), 10)
  } finally { await Promise.all(apps.map(app => app.close())); await db.close() }
})

test('Google callback preserves English locale on successful and failed sign-in', async () => {
  const db = await sandbox()
  const googleClient = {
    authorizeUrl: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange: async ({ code }) => {
      if (code === 'fail') throw new Error('provider failure')
      return { sub: 'english-user', email: 'english@gmail.com', name: 'English' }
    }
  }
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' })
  const app = await createApp(config, false, { googleClient })
  try {
    for (const code of ['fail', 'ok']) {
      const start = await post(app, 'google/start', { returnTo: '/en/me' })
      assert.equal(start.statusCode, 200, start.body)
      const state = new URL(start.json().authorizationUrl).searchParams.get('state')
      const callback = await app.inject({ method: 'GET',
        url: `/api/auth/google/callback?state=${state}&code=${code}`,
        headers: { cookie: cookieOf(start, 'bazaar_google_state') } })
      assert.equal(callback.statusCode, 302, callback.body)
      assert.equal(callback.headers.location, code === 'fail'
        ? `${origin}/en/login?authError=GOOGLE_INVALID` : `${origin}/en/me`)
    }
  } finally { await app.close(); await db.close() }
})

test('password account must reauthenticate before enabling email code login', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: { send: async message => { sent.push(message) } } })
  try {
    await provisionAccounts(db.client, [
      { loginName: 'old@gmail.com', displayName: 'Old', password },
      { loginName: 'other', displayName: 'Other', password }
    ])
    const other = await post(app, 'login', { loginName: 'other', password })
    const otherHeaders = { cookie: cookieOf(other), 'x-csrf-token': other.json().csrfToken }
    assert.equal((await post(app, 'email/bind/request', {
      email: 'old@gmail.com', password
    }, otherHeaders)).statusCode, 202)
    const wrongBind = await post(app, 'email/bind/verify', {
      email: 'old@gmail.com', code: sent[0].code
    }, otherHeaders)
    assert.equal(wrongBind.statusCode, 409, wrongBind.body)
    assert.equal(await db.client.accountIdentity.count({ where: { provider: 'email' } }), 0)
    await db.client.emailCodeChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 120000) } })
    const login = await post(app, 'login', { loginName: 'old@gmail.com', password })
    const headers = { cookie: cookieOf(login), 'x-csrf-token': login.json().csrfToken }
    assert.equal((await post(app, 'email/bind/request', { email: 'old@gmail.com' }, headers)).statusCode, 401)
    assert.equal((await post(app, 'email/bind/request', { email: 'old@gmail.com', password }, headers)).statusCode, 202)
    const bind = await post(app, 'email/bind/verify', { email: 'old@gmail.com', code: sent.at(-1).code }, headers)
    assert.equal(bind.statusCode, 200, bind.body)
    assert.equal((await db.client.accountIdentity.findFirstOrThrow({ where: { provider: 'email' } })).accountId,
      login.json().account.id)
    assert.equal((await post(app, 'session', {}, { cookie: headers.cookie })).statusCode, 401)
    // The binding code is purpose-specific and cannot be reused as a login code.
    assert.equal((await post(app, 'email/verify', { email: 'old@gmail.com', code: sent.at(-1).code })).statusCode, 401)
  } finally { await app.close(); await db.close() }
})

test('parallel email requests issue one code and parallel verification consumes it once', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: { send: async message => { sent.push(message) } } })
  try {
    const requested = await Promise.all([
      post(app, 'email/request', { email: 'race@gmail.com' }),
      post(app, 'email/request', { email: 'race@gmail.com' })
    ])
    assert.deepEqual(requested.map(result => result.statusCode).sort(), [202, 429])
    assert.equal(sent.length, 1)
    const verified = await Promise.all([
      post(app, 'email/verify', { email: 'race@gmail.com', code: sent[0].code }),
      post(app, 'email/verify', { email: 'race@gmail.com', code: sent[0].code })
    ])
    assert.deepEqual(verified.map(result => result.statusCode).sort(), [200, 401])
    assert.equal(await db.client.account.count({ where: { loginName: 'race@gmail.com' } }), 1)
    assert.equal(await db.client.session.count({ where: { revokedAt: null } }), 1)
  } finally { await app.close(); await db.close() }
})
