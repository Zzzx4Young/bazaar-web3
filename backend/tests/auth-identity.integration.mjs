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
        ? { email: 'new@gmail.com', code: '123456', intent: 'login' }
        : { email: 'new@gmail.com', intent: 'login' })
      assert.equal(response.statusCode, 503, response.body)
      assert.equal(response.json().code, 'EMAIL_UNAVAILABLE')
    }
    assert.equal(await db.client.emailCodeChallenge.count(), 0)
  } finally { await app.close(); await db.close() }
})

test('local inbox codes record development provenance separately from delivered email', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'dev_inbox', send: async message => { sent.push(message) }
  } })
  try {
    assert.equal((await post(app, 'email/request', {
      email: 'dev.account@gmail.com', intent: 'register'
    })).statusCode, 202)
    const verified = await post(app, 'email/verify', {
      email: 'dev.account@gmail.com', code: sent[0].code, intent: 'register'
    })
    assert.equal(verified.statusCode, 200, verified.body)
    const accountId = verified.json().account.id
    assert.equal((await db.client.accountIdentity.findFirstOrThrow({
      where: { accountId, provider: 'email' }
    })).verificationSource, 'dev_inbox')
    assert.equal((await db.client.session.findFirstOrThrow({
      where: { accountId }
    })).authMethod, 'email_code_dev')
    assert.equal((await db.client.accountIdentityEvent.findFirstOrThrow({
      where: { accountId }
    })).verificationSource, 'dev_inbox')
  } finally { await app.close(); await db.close() }
})

test('identity event write failure rolls back registration and preserves the challenge', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async message => { sent.push(message) }
  } })
  try {
    const email = 'audit.rollback@gmail.com'
    assert.equal((await post(app, 'email/request', { email, intent: 'register' })).statusCode, 202)
    await db.client.$executeRawUnsafe(`CREATE FUNCTION reject_identity_event() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'identity event unavailable'; END $$`)
    await db.client.$executeRawUnsafe(`CREATE TRIGGER reject_identity_event_before_insert
      BEFORE INSERT ON "AccountIdentityEvent" FOR EACH ROW
      EXECUTE FUNCTION reject_identity_event()`)
    const failed = await post(app, 'email/verify', {
      email, code: sent[0].code, intent: 'register'
    })
    assert.notEqual(failed.statusCode, 200)
    assert.equal(await db.client.account.count(), 0)
    assert.equal(await db.client.accountIdentity.count(), 0)
    assert.equal(await db.client.gmailClaim.count(), 0)
    assert.equal(await db.client.session.count(), 0)
    assert.equal((await db.client.emailCodeChallenge.findFirstOrThrow()).consumedAt, null)
    await db.client.$executeRawUnsafe('DROP TRIGGER reject_identity_event_before_insert ON "AccountIdentityEvent"')
    const retried = await post(app, 'email/verify', {
      email, code: sent[0].code, intent: 'register'
    })
    assert.equal(retried.statusCode, 200, retried.body)
    assert.equal(await db.client.accountIdentityEvent.count(), 1)
  } finally { await app.close(); await db.close() }
})

test('email register and login have separate intents and a login never creates an account', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async message => { sent.push(message) }
  } })
  try {
    const address = 'New.User+Shop@gmail.com'
    const request = async (intent, email = address) => post(app, 'email/request', { email, intent })
    const verify = async (intent, code, email = address) =>
      post(app, 'email/verify', { email, code, intent })
    assert.equal((await request('login')).statusCode, 202)
    const missing = await verify('login', sent.at(-1).code)
    assert.equal(missing.statusCode, 404, missing.body)
    assert.equal(missing.json().code, 'EMAIL_ACCOUNT_NOT_FOUND')
    assert.equal(await db.client.account.count(), 0)
    assert.equal((await verify('login', sent.at(-1).code)).statusCode, 401)
    assert.equal((await request('register')).statusCode, 202)
    const registered = await verify('register', sent.at(-1).code)
    assert.equal(registered.statusCode, 200, registered.body)
    assert.equal(registered.json().account.loginName, 'newuser@gmail.com')
    const registeredIdentity = await db.client.accountIdentity.findFirstOrThrow({
      where: { accountId: registered.json().account.id, provider: 'email' }
    })
    assert.ok(registeredIdentity.verifiedAt instanceof Date)
    assert.equal(registeredIdentity.verificationSource, 'email_delivery')
    const registeredSession = await db.client.session.findFirstOrThrow({
      where: { accountId: registered.json().account.id }
    })
    assert.equal(registeredSession.authMethod, 'email_code')
    assert.ok(registeredSession.authenticatedAt instanceof Date)
    assert.equal(await db.client.accountIdentityEvent.count({
      where: { accountId: registered.json().account.id, action: 'register' }
    }), 1)
    assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
      where: { key: 'newuser@gmail.com' }
    })).accountId, registered.json().account.id)
    assert.equal((await request('register', 'newuser@gmail.com')).statusCode, 202)
    const duplicate = await verify('register', sent.at(-1).code, 'newuser@gmail.com')
    assert.equal(duplicate.statusCode, 409, duplicate.body)
    assert.equal(duplicate.json().code, 'EMAIL_ACCOUNT_EXISTS')
    assert.equal((await request('login', 'newuser@gmail.com')).statusCode, 202)
    const loggedIn = await verify('login', sent.at(-1).code, 'newuser@gmail.com')
    assert.equal(loggedIn.statusCode, 200, loggedIn.body)
    assert.equal(loggedIn.json().account.id, registered.json().account.id)
    assert.equal(await db.client.accountIdentityEvent.count({
      where: { accountId: registered.json().account.id }
    }), 1)
  } finally { await app.close(); await db.close() }
})

test('email code creates a new account once, persists bad attempts, rotates session and rejects password-account login', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async message => { sent.push(message) }
  } })
  try {
    await provisionAccounts(db.client, [{ loginName: 'old@gmail.com', displayName: 'Old', password }])
    assert.equal((await post(app, 'email/request', { email: 'new@gmail.com', locale: 'zh-CN',
      intent: 'register' })).statusCode, 202)
    assert.match(sent[0].code, /^\d{6}$/)
    const wrong = await post(app, 'email/verify', {
      email: 'new@gmail.com', code: '999999', intent: 'register' })
    assert.equal(wrong.statusCode, 401, wrong.body)
    assert.equal((await db.client.emailCodeChallenge.findFirstOrThrow()).attempts, 1)
    const verified = await post(app, 'email/verify', {
      email: 'new@gmail.com', code: sent[0].code, intent: 'register' })
    assert.equal(verified.statusCode, 200, verified.body)
    assert.equal(verified.json().account.loginName, 'new@gmail.com')
    assert.equal(await db.client.accountIdentity.count({ where: { provider: 'email' } }), 1)
    assert.equal((await post(app, 'email/verify', {
      email: 'new@gmail.com', code: sent[0].code, intent: 'register' })).statusCode, 401)
    const oldCookie = cookieOf(verified)
    await db.client.emailCodeChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 120000) } })
    assert.equal((await post(app, 'email/request', {
      email: 'new@gmail.com', intent: 'login' })).statusCode, 202)
    const again = await post(app, 'email/verify', {
      email: 'new@gmail.com', code: sent.at(-1).code, intent: 'login' }, { cookie: oldCookie })
    assert.equal(again.statusCode, 200, again.body)
    assert.notEqual(cookieOf(again), oldCookie)
    assert.equal((await post(app, 'session', {}, { cookie: oldCookie })).statusCode, 401)

    assert.equal((await post(app, 'email/request', {
      email: 'old@gmail.com', intent: 'login' })).statusCode, 202)
    const conflict = await post(app, 'email/verify', {
      email: 'old@gmail.com', code: sent.at(-1).code, intent: 'login' })
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
    const googleAccount = await db.client.accountIdentity.findFirstOrThrow({
      where: { provider: 'google', subject: 'google-1' }
    })
    assert.equal(googleAccount.verificationSource, 'google_oidc')
    assert.ok(googleAccount.verifiedAt instanceof Date)
    assert.equal((await db.client.session.findFirstOrThrow({
      where: { accountId: googleAccount.accountId }
    })).authMethod, 'google_oidc')
    assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
      where: { key: 'new@gmail.com' }
    })).accountId, googleAccount.accountId)
    assert.equal((await app.inject({ method: 'GET', url: `/api/auth/google/callback?state=${state}&code=new`, headers: { cookie: attemptCookie } })).statusCode, 302)
    assert.equal(await db.client.accountIdentity.count({ where: { provider: 'google' } }), 1)

    profiles.set('changed', { sub: 'google-1', email: 'changed@gmail.com', name: 'New' })
    const changedStart = await post(app, 'google/start', {})
    const changedState = new URL(changedStart.json().authorizationUrl).searchParams.get('state')
    const changed = await app.inject({ method: 'GET',
      url: `/api/auth/google/callback?state=${changedState}&code=changed`,
      headers: { cookie: cookieOf(changedStart, 'bazaar_google_state') } })
    assert.equal(changed.statusCode, 302, changed.body)
    assert.ok(cookieOf(changed))
    assert.equal((await db.client.accountIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: 'google', subject: 'google-1' } }
    })).email, 'new@gmail.com')
    assert.equal(await db.client.gmailClaim.count({ where: { key: 'changed@gmail.com' } }), 0)

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

test('Google rebinding releases an old claim only when no other identity backs it', async () => {
  const db = await sandbox()
  const profiles = new Map([
    ['old', { sub: 'google-old', email: 'old.google@gmail.com', name: 'Old' }],
    ['new', { sub: 'google-new', email: 'new.google@gmail.com', name: 'New' }]
  ])
  const googleClient = {
    authorizeUrl: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange: async ({ code }) => profiles.get(code)
  }
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' })
  const app = await createApp(config, false, { googleClient })
  try {
    await provisionAccounts(db.client, [{ loginName: 'local', displayName: 'Local', password }])
    for (const code of ['old', 'new']) {
      const login = await post(app, 'login', { loginName: 'local', password })
      const started = await post(app, 'google/bind/start', { password }, {
        cookie: cookieOf(login), 'x-csrf-token': login.json().csrfToken
      })
      assert.equal(started.statusCode, 200, started.body)
      const state = new URL(started.json().authorizationUrl).searchParams.get('state')
      const callback = await app.inject({ method: 'GET',
        url: `/api/auth/google/callback?state=${state}&code=${code}`,
        headers: { cookie: `${cookieOf(login)}; ${cookieOf(started, 'bazaar_google_state')}` } })
      assert.equal(callback.statusCode, 302, callback.body)
    }
    assert.equal(await db.client.gmailClaim.count({ where: { key: 'oldgoogle@gmail.com' } }), 0)
    assert.equal(await db.client.gmailClaim.count({ where: { key: 'newgoogle@gmail.com' } }), 1)
    const events = await db.client.accountIdentityEvent.findMany({
      where: { provider: 'google' }, orderBy: { createdAt: 'asc' }
    })
    assert.deepEqual(events.map(event => event.action), ['bind', 'replace'])
    assert.equal(events[1].previousEmail, 'old.google@gmail.com')
    assert.equal(events[1].currentEmail, 'new.google@gmail.com')
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

test('Google callback Location stays on the configured origin for accepted return paths', async () => {
  const db = await sandbox()
  const googleClient = {
    authorizeUrl: ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange: async () => ({ sub: 'safe-redirect-user', email: 'safe@gmail.com', name: 'Safe' })
  }
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' })
  const app = await createApp(config, false, { googleClient })
  try {
    for (const returnTo of ['/en/me?tab=profile', '/en/explore?q=foo+bar',
      '/en/products?sort=price#results', '/en//example.com',
      '/en/%2F%2Fexample.com', '/en/../me']) {
      const start = await post(app, 'google/start', { returnTo })
      assert.equal(start.statusCode, 200, start.body)
      const state = new URL(start.json().authorizationUrl).searchParams.get('state')
      const callback = await app.inject({ method: 'GET',
        url: `/api/auth/google/callback?state=${state}&code=ok`,
        headers: { cookie: cookieOf(start, 'bazaar_google_state') } })
      assert.equal(callback.statusCode, 302, callback.body)
      assert.equal(callback.headers.location, `${origin}${returnTo}`)
      assert.equal(new URL(callback.headers.location).origin, origin)
    }
    for (const returnTo of ['//example.com', 'https://example.com',
      '/en/\\example.com', '/en/evil\npath']) {
      const start = await post(app, 'google/start', { returnTo })
      assert.equal(start.statusCode, 400, start.body)
    }
  } finally { await app.close(); await db.close() }
})

test('password account must reauthenticate before enabling email code login', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async message => { sent.push(message) }
  } })
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
    assert.equal((await post(app, 'email/verify', {
      email: 'old@gmail.com', code: sent.at(-1).code, intent: 'login' })).statusCode, 401)
  } finally { await app.close(); await db.close() }
})

test('explicit local development binding bypass still requires session, CSRF, and email code', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    NODE_ENV: 'development', DEV_EMAIL_BIND_SKIP_REAUTH: '1',
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async message => { sent.push(message) }
  } })
  try {
    await provisionAccounts(db.client, [{ loginName: 'local@gmail.com',
      displayName: 'Local', password }])
    const login = await post(app, 'login', { loginName: 'local@gmail.com', password })
    const cookie = cookieOf(login)
    const payload = { email: 'local@gmail.com' }
    assert.equal((await post(app, 'email/bind/request', payload)).statusCode, 401)
    assert.equal((await post(app, 'email/bind/request', payload, { cookie })).statusCode, 403)
    const headers = { cookie, 'x-csrf-token': login.json().csrfToken }
    assert.equal((await post(app, 'email/bind/request', payload, headers)).statusCode, 202)
    assert.equal((await post(app, 'email/bind/verify', {
      ...payload, code: '999999'
    }, headers)).statusCode, 401)
    const verified = await post(app, 'email/bind/verify', {
      ...payload, code: sent[0].code
    }, headers)
    assert.equal(verified.statusCode, 200, verified.body)
    assert.equal((await db.client.accountIdentity.findUniqueOrThrow({
      where: { accountId_provider: { accountId: login.json().account.id, provider: 'email' } }
    })).subject, 'local@gmail.com')
  } finally { await app.close(); await db.close() }
})

test('parallel email requests issue one code and parallel verification consumes it once', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async message => { sent.push(message) }
  } })
  try {
    const requested = await Promise.all([
      post(app, 'email/request', { email: 'race@gmail.com', intent: 'register' }),
      post(app, 'email/request', { email: 'race@gmail.com', intent: 'register' })
    ])
    assert.deepEqual(requested.map(result => result.statusCode).sort(), [202, 429])
    assert.equal(sent.length, 1)
    const verified = await Promise.all([
      post(app, 'email/verify', { email: 'race@gmail.com', code: sent[0].code,
        intent: 'register' }),
      post(app, 'email/verify', { email: 'race@gmail.com', code: sent[0].code,
        intent: 'register' })
    ])
    assert.deepEqual(verified.map(result => result.statusCode).sort(), [200, 401])
    assert.equal(await db.client.account.count({ where: { loginName: 'race@gmail.com' } }), 1)
    assert.equal(await db.client.session.count({ where: { revokedAt: null } }), 1)
  } finally { await app.close(); await db.close() }
})

test('Gmail aliases share the hourly send limit and report its remaining retry window', async () => {
  const db = await sandbox()
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async () => {}
  } })
  try {
    for (let index = 0; index < 5; index++) {
      const result = await post(app, 'email/request', {
        email: `lim.it+${index}@gmail.com`, intent: 'register'
      })
      assert.equal(result.statusCode, 202, result.body)
    }
    const limited = await post(app, 'email/request', {
      email: 'limit+again@gmail.com', intent: 'register'
    })
    assert.equal(limited.statusCode, 429, limited.body)
    assert.ok(Number(limited.headers['retry-after']) > 3500)
  } finally { await app.close(); await db.close() }
})

test('replacing a linked email keeps the claim backed by a dotted account login name', async () => {
  const db = await sandbox()
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    NODE_ENV: 'development', DEV_EMAIL_BIND_SKIP_REAUTH: '1',
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: {
    provenance: 'email_delivery', send: async message => { sent.push(message) }
  } })
  try {
    const original = 'dot.ted.user@gmail.com'
    await provisionAccounts(db.client, [{ loginName: original, displayName: 'Dotted', password }])
    const login = await post(app, 'login', { loginName: original, password })
    let headers = { cookie: cookieOf(login), 'x-csrf-token': login.json().csrfToken }
    for (const email of [original, 'other.address@gmail.com']) {
      assert.equal((await post(app, 'email/bind/request', { email }, headers)).statusCode, 202)
      const bound = await post(app, 'email/bind/verify', {
        email, code: sent.at(-1).code
      }, headers)
      assert.equal(bound.statusCode, 200, bound.body)
      headers = { cookie: cookieOf(bound), 'x-csrf-token': bound.json().csrfToken }
    }
    const accountId = login.json().account.id
    assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
      where: { key: 'dotteduser@gmail.com' }
    })).accountId, accountId)
    const events = await db.client.accountIdentityEvent.findMany({
      where: { accountId, provider: 'email' }, orderBy: { createdAt: 'asc' }
    })
    assert.deepEqual(events.map(event => event.action), ['bind', 'replace'])
    assert.equal(events[1].previousSubject, original)
    assert.equal(events[1].currentSubject, 'other.address@gmail.com')
    assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
      where: { key: 'otheraddress@gmail.com' }
    })).accountId, accountId)
  } finally { await app.close(); await db.close() }
})

test('a failed email delivery can be requested again without a stale resend cooldown', async () => {
  const db = await sandbox()
  let attempts = 0
  const sent = []
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'test-only-32-byte-secret-for-email-code' })
  const app = await createApp(config, false, { emailSender: { provenance: 'email_delivery', send: async message => {
    attempts++
    if (attempts === 1) throw new Error('test delivery failure')
    sent.push(message)
  } } })
  try {
    const payload = { email: 'retry@gmail.com', intent: 'register' }
    const failed = await post(app, 'email/request', payload)
    assert.equal(failed.statusCode, 503, failed.body)
    assert.equal(failed.json().code, 'EMAIL_UNAVAILABLE')
    assert.equal((await post(app, 'email/request', payload)).statusCode, 202)
    const verified = await post(app, 'email/verify', {
      ...payload, code: sent[0].code
    })
    assert.equal(verified.statusCode, 200, verified.body)
  } finally { await app.close(); await db.close() }
})
