import {URLSearchParams} from 'node:url'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sandbox, fixture } from './helpers/database.mjs'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { readConfig } from '../dist/config.js'
import { hashPassword } from '../dist/auth/password.js'
import { createApp } from '../dist/app.js'
const origin = 'http://localhost:3000', password = 'Wallet-http-test-password-123'
async function setup(enabled = true, eoa = async () => {}, options = {}) {
  const db = await sandbox(), security = await isolatedLedger(), f = await fixture(db, 'digital')
  await db.client.accountCredential.create({ data: { accountId: f.buyer, passwordHash: await hashPassword(password) } })
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin, ...(options.google ? { GOOGLE_CLIENT_ID: 't09-http-only-client', GOOGLE_CLIENT_SECRET: 't09-http-only-secret' } : {}) })
  const messages = []
  if (options.email) {
    config.emailCodeKey = Buffer.from('a'.repeat(64), 'hex')
    config.devEmailBindSkipReauth = true
  }
  if (enabled) config.web3 = { chainId: 11155111, tokenDecimals: 6, token: '0x' + '1'.repeat(40),
    escrow: '0x' + '2'.repeat(40), rpcPrimary: 'https://one.invalid', rpcSecondary: 'https://two.invalid',
    securityLedgerUrl: db.url.toString(), securityLedgerId: security.id }
  if (options.google) await db.client.accountIdentity.create({data:{accountId:f.buyer,provider:'google',subject:'t09-http-sub',email:'t09-http@gmail.com',verifiedAt:new Date(),verificationSource:'google_oidc'}})
  const app = await createApp(config, false, {
    walletGoogleClient: options.google ? {authorizeUrl:({state})=>'https://accounts.google.com/o/oauth2/v2/auth?state='+encodeURIComponent(state),exchange:async()=>({sub:'t09-http-sub',email:'t09-http@gmail.com',name:'Test provider'})} : undefined, walletLedger: security.ledger, walletEoaCheck: eoa,
    emailSender: options.email ? { provenance: 'dev_inbox', send: async message => { messages.push(message) } } : undefined })
  const account = await db.client.account.findUniqueOrThrow({ where: { id: f.buyer } })
  const post = (url, payload, extra = {}) => app.inject({ method: 'POST', url: `/api/auth/wallet/${url}`,
    headers: { origin, ...extra }, payload })
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin },
    payload: { loginName: account.loginName, password } })
  assert.equal(login.statusCode, 200, login.body)
  const headers = { cookie: login.headers['set-cookie'].split(';')[0],
    'x-csrf-token': login.json().csrfToken, 'idempotency-key': randomUUID() }
  return { db, security, app, f, post, headers, messages, close: async () => { await app.close(); await db.close(); await security.close() } }
}

test('A30/A32: wallet HTTP enforces auth/origin/CSRF and rotates wallet login sessions', async () => {
  const t = await setup()
  try {
    const w = privateKeyToAccount(generatePrivateKey()), payload = { purpose: 'bind', address: w.address, password }
    assert.equal((await t.post('reauth/password', payload)).statusCode, 401)
    assert.equal((await t.post('reauth/password', payload, { cookie: t.headers.cookie })).statusCode, 403)
    assert.equal((await t.post('reauth/password', payload, { ...t.headers, origin: 'https://evil.invalid' })).statusCode, 403)
    const reauth = await t.post('reauth/password', payload, t.headers)
    assert.equal(reauth.statusCode, 200, reauth.body)
    const c = await t.post('challenge', { proofId: reauth.json().id, purpose: 'bind', address: w.address }, t.headers)
    assert.equal(c.statusCode, 200, c.body)
    const signature = await w.signTypedData(c.json().typedData)
    const signed = await t.post('consume', { id: c.json().id, signature }, t.headers)
    assert.equal(signed.statusCode, 200, signed.body)
    assert.deepEqual((await t.post('consume', { id: c.json().id, signature }, t.headers)).json(), signed.json())
    const loginChallenge = await t.post('login/challenge', { address: w.address })
    assert.equal(loginChallenge.statusCode, 200, loginChallenge.body)
    const claim = loginChallenge.json()
    const walletLogin = await t.post('login/verify', { id: claim.id, message: claim.message,
      signature: await w.signMessage({ message: claim.message }) }, { cookie: t.headers.cookie })
    assert.equal(walletLogin.statusCode, 200, walletLogin.body)
    const session = await t.app.inject({ method: 'POST', url: '/api/auth/session',
      headers: { origin, cookie: t.headers.cookie }, payload: {} })
    assert.equal(session.statusCode, 401)
    assert.match(walletLogin.headers['set-cookie'], /HttpOnly; SameSite=Lax/)
    assert.equal(walletLogin.headers['cache-control'], 'no-store')
  } finally { await t.close() }
})

test('A18: disabled wallet paths and EOA provider outage do not permit binding', async () => {
  const disabled = await setup(false)
  try { assert.equal((await disabled.post('current', {}, disabled.headers)).statusCode, 503) }
  finally { await disabled.close() }
  const t = await setup(true, async () => { throw new Error('simulated RPC failure') })
  try {
    const w = privateKeyToAccount(generatePrivateKey())
    const reauth = await t.post('reauth/password', { purpose: 'bind', address: w.address, password }, t.headers)
    const c = await t.post('challenge', { proofId: reauth.json().id, purpose: 'bind', address: w.address }, t.headers)
    const response = await t.post('consume', { id: c.json().id, signature: await w.signTypedData(c.json().typedData) }, t.headers)
    assert.equal(response.statusCode, 503, response.body)
    assert.equal(response.json().code, 'WALLET_UNAVAILABLE')
    assert.equal(await t.db.client.walletIdentity.count(), 0)
  } finally { await t.close() }
})

test('A32: an idempotency key cannot be reused to replace the bound wallet target', async () => {
  const t = await setup()
  try {
    const one = privateKeyToAccount(generatePrivateKey()), two = privateKeyToAccount(generatePrivateKey())
    const first = await t.post('reauth/password', { purpose: 'bind', address: one.address, password }, t.headers)
    assert.equal(first.statusCode, 200)
    const conflict = await t.post('reauth/password', { purpose: 'bind', address: two.address, password }, t.headers)
    assert.equal(conflict.statusCode, 409, conflict.body)
    assert.equal(conflict.json().code, 'IDEMPOTENCY_CONFLICT')
  } finally { await t.close() }
})

test('wallet-only sessions cannot bootstrap an independent email even with development bind bypass enabled', async () => {
  const t = await setup(true, async () => {}, { email: true })
  try {
    const w = privateKeyToAccount(generatePrivateKey())
    const proof = await t.post('reauth/password', { purpose: 'bind', address: w.address, password }, t.headers)
    const c = await t.post('challenge', { proofId: proof.json().id, purpose: 'bind', address: w.address }, t.headers)
    await t.post('consume', { id: c.json().id, signature: await w.signTypedData(c.json().typedData) }, t.headers)
    const login = (await t.post('login/challenge', { address: w.address })).json()
    const signedIn = await t.post('login/verify', { id: login.id, message: login.message,
      signature: await w.signMessage({ message: login.message }) })
    assert.equal(signedIn.statusCode, 200, signedIn.body)
    await t.db.client.accountCredential.delete({ where: { accountId: t.f.buyer } })
    const headers = { origin, cookie: signedIn.headers['set-cookie'].split(';')[0], 'x-csrf-token': signedIn.json().csrfToken }
    for (const [path, payload] of [['email/bind/request', { email: 'untrusted-new@gmail.com' }], ['google/bind/start', {}]]) {
      const response = await t.app.inject({ method: 'POST', url: `/api/auth/${path}`, headers, payload })
      assert.equal(response.statusCode, 401, response.body)
      assert.equal(response.json().code, 'INVALID_CREDENTIALS')
    }
    assert.equal(t.messages.length, 0)
    assert.equal(await t.db.client.googleOAuthAttempt.count(), 0)
  } finally { await t.close() }
})

test('A18: public wallet challenge rate limits apply before challenge persistence', async () => {
  const t = await setup()
  try {
    const w = privateKeyToAccount(generatePrivateKey())
    for (let i = 0; i < 10; i++) assert.equal((await t.post('login/challenge', { address: w.address })).statusCode, 401)
    const blocked = await t.post('login/challenge', { address: w.address })
    assert.equal(blocked.statusCode, 429, blocked.body)
    assert.equal(blocked.json().code, 'RATE_LIMITED')
    assert.equal(await t.db.client.walletChallenge.count(), 0)
  } finally { await t.close() }
})

test('T09 Google HTTP: HTML callback uses stored locale and clears cookie; JSON compatibility remains', async () => {
 const t=await setup(true,async()=>{},{google:true})
 try {
  const address=privateKeyToAccount(generatePrivateKey()).address
  const start=await t.post('reauth/google/start',{purpose:'bind',address,locale:'en'},t.headers)
  assert.equal(start.statusCode,200,start.body)
  const state=new URL(start.json().authorizationUrl).searchParams.get('state')
  const callback=await t.app.inject({method:'GET',url:'/api/auth/wallet/reauth/google/callback?'+new URLSearchParams({state,code:'provider-test-code'}),headers:{accept:'text/html',cookie:t.headers.cookie+'; '+start.headers['set-cookie'].split(';')[0]}})
  assert.equal(callback.statusCode,303,callback.body)
  assert.equal(callback.headers.location,origin+'/en/wallet/reauth')
  assert.match(callback.headers['set-cookie'],/Max-Age=0/)
  assert.equal(callback.headers['cache-control'],'no-store')
  const legacy=await t.post('reauth/google/start',{purpose:'bind',address},{...t.headers,'idempotency-key':randomUUID()})
  assert.equal(legacy.statusCode,200,legacy.body)
  const legacyState=new URL(legacy.json().authorizationUrl).searchParams.get('state')
  const json=await t.app.inject({method:'GET',url:'/api/auth/wallet/reauth/google/callback?'+new URLSearchParams({state:legacyState,code:'provider-test-code'}),headers:{accept:'application/json',cookie:t.headers.cookie+'; '+legacy.headers['set-cookie'].split(';')[0]}})
  assert.equal(json.statusCode,200,json.body)
  assert.equal(json.json().id,legacy.json().id)
  assert.equal(json.json().expiresAt,legacy.json().expiresAt)
  assert.deepEqual(Object.keys(json.json()).sort(),['expiresAt','id'])
 }finally{await t.close()}
})
