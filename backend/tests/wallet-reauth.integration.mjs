import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sandbox, fixture } from './helpers/database.mjs'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { AuthService } from '../dist/auth/auth.service.js'
import { WalletAuthService } from '../dist/auth/wallet-auth.service.js'
import { WalletReauthService } from '../dist/auth/wallet-reauth.service.js'
import { readConfig } from '../dist/config.js'

const origin = 'http://localhost:3000'
async function setup() {
  const db = await sandbox(), security = await isolatedLedger(), f = await fixture(db, 'digital')
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'wallet-test-client', GOOGLE_CLIENT_SECRET: 'wallet-test-provider-secret',
    EMAIL_CODE_HMAC_KEY: 'a'.repeat(64) })
  // Explicit test config: never reads host email credentials.
  config.emailCodeKey = Buffer.from('a'.repeat(64), 'hex')
  const auth = new AuthService(db.client, config, security.ledger)
  const account = await db.client.account.findUniqueOrThrow({ where: { id: f.buyer } })
  const user = await db.client.$transaction(tx => auth.issueSession(tx, account, undefined, 'email_code_dev'))
  await db.client.accountIdentity.create({ data: { accountId: account.id, provider: 'email',
    subject: 'virtualbuyer@gmail.com', email: 'virtualbuyer@gmail.com', verifiedAt: new Date(), verificationSource: 'dev_inbox' } })
  await db.client.accountIdentity.create({ data: { accountId: account.id, provider: 'google',
    subject: 'virtual-google-sub', email: 'virtualbuyer@gmail.com', verifiedAt: new Date(), verificationSource: 'google_oidc' } })
  const wallets = new WalletAuthService(db.client, auth, security.ledger, { chainId: 11155111,
    escrow: '0x' + 'a'.repeat(40), appOrigin: origin, assertEoa: async () => {} })
  const messages = [], exchanges = []
  let profile = { sub: 'virtual-google-sub', email: 'virtualbuyer@gmail.com', name: 'Buyer' }
  const google = { authorizeUrl: ({ state, nonce }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`,
    exchange: async input => { exchanges.push(input); return profile } }
  const sender = { provenance: 'dev_inbox', send: async input => { messages.push(input) } }
  const reauth = new WalletReauthService(db.client, auth, wallets, config, sender, google)
  return { db, security, wallets, reauth, auth, user, messages, exchanges,
    setProfile: p => { profile = p }, wallet: privateKeyToAccount(generatePrivateKey()),
    close: async () => { await db.close(); await security.close() } }
}

test('A30/A32: dedicated email proof binds session and action, persists failures and does not renew expiry', async () => {
  const t = await setup()
  try {
    const key = randomUUID()
    const requested = await t.reauth.requestEmail(t.user, 'bind', t.wallet.address, key, 'en', '127.0.0.1')
    assert.equal(t.messages.length, 1)
    assert.equal(t.messages[0].purpose, 'wallet_reauth')
    assert.equal((await t.reauth.requestEmail(t.user, 'bind', t.wallet.address, key, 'en', '127.0.0.1')).id, requested.id)
    assert.equal(t.messages.length, 1)
    await assert.rejects(t.wallets.createActionChallenge(t.user, requested.id, 'bind', t.wallet.address, key), /INVALID_CREDENTIALS/)
    const code = t.messages[0].code, wrong = code === '000000' ? '000001' : '000000'
    await assert.rejects(t.reauth.verifyEmail(t.user, requested.id, wrong, '127.0.0.1'), /INVALID_CREDENTIALS/)
    assert.equal((await t.db.client.walletChallenge.findUniqueOrThrow({ where: { id: requested.id } })).payload.attempts, 1)
    const proof = await t.reauth.verifyEmail(t.user, requested.id, code, '127.0.0.1')
    assert.equal(proof.expiresAt, requested.expiresAt)
    const action = await t.wallets.createActionChallenge(t.user, proof.id, 'bind', t.wallet.address, key)
    assert.equal(action.expiresAt, proof.expiresAt)
    const stored = await t.db.client.walletChallenge.findUniqueOrThrow({ where: { id: action.id } })
    assert.equal(stored.payload.source, 'email_code_dev')
    await assert.rejects(t.wallets.createActionChallenge(t.user, proof.id, 'unbind', t.wallet.address, randomUUID()), /INVALID_CREDENTIALS/)
    await t.wallets.consumeActionChallenge(t.user, action.id, await t.wallet.signTypedData(action.typedData))
  } finally { await t.close() }
})

test('A30: Google reauthentication requires linked sub, browser state and original session; no session rotation', async () => {
  const t = await setup()
  try {
    const key = randomUUID()
    const attempt = await t.reauth.startGoogle(t.user, 'bind', t.wallet.address, key, '127.0.0.1')
    const retry = await t.reauth.startGoogle(t.user, 'bind', t.wallet.address, key, '127.0.0.1')
    assert.equal(retry.cookie?.split(';')[0], attempt.cookie.split(';')[0])
    assert.equal(retry.expiresAt, attempt.expiresAt)
    const state = new URL(attempt.authorizationUrl).searchParams.get('state')
    const cookie = attempt.cookie.split(';')[0]
    await assert.rejects(t.reauth.completeGoogle(t.user, state, 'test-code', ''), /GOOGLE_INVALID/)
    const proof = await t.reauth.completeGoogle(t.user, state, 'test-code', cookie)
    assert.equal(proof.id, attempt.id)
    assert.equal(proof.expiresAt, attempt.expiresAt)
    assert.equal((await t.auth.authenticate(`bazaar_session=${t.user.token}`)).token, t.user.token)
    assert.equal(t.exchanges.length, 1)
    assert.equal((await t.reauth.completeGoogle(t.user, state, 'test-code', cookie)).id, proof.id)
    assert.equal(t.exchanges.length, 1)
    const c = await t.wallets.createActionChallenge(t.user, proof.id, 'bind', t.wallet.address, randomUUID())
    assert.equal((await t.db.client.walletChallenge.findUniqueOrThrow({ where: { id: c.id } })).payload.source, 'google_oidc')
  } finally { await t.close() }
})

test('A30: a different Google sub or revoked session cannot authorize binding', async () => {
  const t = await setup()
  try {
    const attempt = await t.reauth.startGoogle(t.user, 'bind', t.wallet.address, randomUUID(), '127.0.0.1')
    const state = new URL(attempt.authorizationUrl).searchParams.get('state')
    t.setProfile({ sub: 'another-google-sub', email: 'virtualbuyer@gmail.com', name: 'Other' })
    await assert.rejects(t.reauth.completeGoogle(t.user, state, 'test-code', attempt.cookie.split(';')[0]), /INVALID_CREDENTIALS|GOOGLE_INVALID/)
    const email = await t.reauth.requestEmail(t.user, 'bind', t.wallet.address, randomUUID(), 'en', '127.0.0.1')
    await t.auth.logout(t.user)
    await assert.rejects(t.reauth.verifyEmail(t.user, email.id, t.messages.at(-1).code, '127.0.0.1'), /UNAUTHENTICATED/)
  } finally { await t.close() }
})

test('T09: Google proof retains the original browser locale without renewing the flow', async () => {
 const t=await setup()
 try {
  const key=randomUUID()
  const start=await t.reauth.startGoogle(t.user,'bind',t.wallet.address,key,'127.0.0.1','en')
  const state=new URL(start.authorizationUrl).searchParams.get('state')
  const proof=await t.reauth.completeGoogle(t.user,state,'test-provider-code',start.cookie.split(';')[0])
  assert.equal(proof.locale,'en')
  assert.equal(proof.expiresAt,start.expiresAt)
 }finally{await t.close()}
})
