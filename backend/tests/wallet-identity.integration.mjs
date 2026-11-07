import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sandbox, fixture } from './helpers/database.mjs'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { AuthService } from '../dist/auth/auth.service.js'
import { WalletAuthService } from '../dist/auth/wallet-auth.service.js'
import { readConfig } from '../dist/config.js'
import { hashPassword } from '../dist/auth/password.js'

const password = 'Wallet-virtual-password-only-123'
const origin = 'http://localhost:3000'

async function setup() {
  const db = await sandbox(), security = await isolatedLedger()
  const f = await fixture(db, 'digital')
  await db.client.accountCredential.create({ data: { accountId: f.buyer, passwordHash: await hashPassword(password) } })
  await db.client.accountCredential.create({ data: { accountId: f.other, passwordHash: await hashPassword(password) } })
  const auth = new AuthService(db.client, readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin }), security.ledger)
  const login = async (id) => {
    const a = await db.client.account.findUniqueOrThrow({ where: { id } })
    return auth.login(a.loginName, password, '127.0.0.1')
  }
  let offset = 0
  const wallets = new WalletAuthService(db.client, auth, security.ledger, {
    chainId: 11155111, escrow: '0x' + 'a'.repeat(40), appOrigin: origin,
    assertEoa: async () => {}, now: () => new Date(Date.now() + offset)
  })
  return { db, security, f, auth, wallets, login, tick: (ms) => { offset += ms },
    close: async () => { await db.close(); await security.close() } }
}

async function bind(t, auth, wallet, key = randomUUID()) {
  const reauth = await t.wallets.requestPasswordReauth(auth, password, 'bind', wallet.address, key, '127.0.0.1')
  const challenge = await t.wallets.createActionChallenge(auth, reauth.id, 'bind', wallet.address, key)
  const signature = await wallet.signTypedData(challenge.typedData)
  return t.wallets.consumeActionChallenge(auth, challenge.id, signature)
}

test('F01/A27/A30: rollback cannot restore old-wallet login, fresh SIWE signatures, or cross-account claims', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), other = await t.login(t.f.other)
    const w1 = privateKeyToAccount(generatePrivateKey()), w2 = privateKeyToAccount(generatePrivateKey())
    await bind(t, user, w1)
    const backup = await t.db.client.walletIdentity.findUniqueOrThrow({ where: { accountId_chainId: {
      accountId: user.account.id, chainId: 11155111 } } })
    const first = await t.wallets.createLoginChallenge(w1.address, '127.0.0.1')
    const firstAuth = await t.wallets.verifyLogin(first.id, first.message,
      await w1.signMessage({ message: first.message }), '127.0.0.1')
    await bind(t, user, w2)
    await assert.rejects(t.auth.authenticate(`bazaar_session=${firstAuth.token}`), /UNAUTHENTICATED/)
    await t.db.client.walletIdentity.update({ where: { id: backup.id }, data: {
      address: backup.address, bindingVersion: backup.bindingVersion, securityRevision: backup.securityRevision } })
    await assert.rejects(t.wallets.createLoginChallenge(w1.address, '127.0.0.1'), /INVALID_CREDENTIALS/)
    await assert.rejects(t.wallets.verifyLogin(first.id, first.message,
      await w1.signMessage({ message: first.message }), '127.0.0.1'), /UNAUTHENTICATED|INVALID_CREDENTIALS/)
    await assert.rejects(bind(t, other, w1), /ACCOUNT_LINK_REQUIRED/)
    await assert.rejects(t.wallets.current(user), /WALLET_UNAVAILABLE/)
  } finally { await t.close() }
})

test('A32: reauthentication and action challenges have strict deadlines and idempotent consumption', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), wallet = privateKeyToAccount(generatePrivateKey()), key = randomUUID()
    const proof = await t.wallets.requestPasswordReauth(user, password, 'bind', wallet.address, key, '127.0.0.1')
    t.tick(299_000)
    const challenge = await t.wallets.createActionChallenge(user, proof.id, 'bind', wallet.address, key)
    assert.equal(challenge.expiresAt, proof.expiresAt)
    assert.equal((await t.wallets.createActionChallenge(user, proof.id, 'bind', wallet.address, key)).id, challenge.id)
    const signature = await wallet.signTypedData(challenge.typedData)
    t.tick(1000)
    await assert.rejects(t.wallets.consumeActionChallenge(user, challenge.id, signature), /INVALID_CREDENTIALS/)
    const success = await bind(t, user, wallet)
    const result = await t.db.client.walletChallenge.findFirstOrThrow({ where: { accountId: user.account.id,
      kind: 'action', consumedAt: { not: null } }, orderBy: { createdAt: 'desc' } })
    assert.deepEqual(await t.wallets.consumeActionChallenge(user, result.id, '0x' + '0'.repeat(130)), success)
    assert.equal(await t.db.client.walletIdentityEvent.count(), 1)
  } finally { await t.close() }
})

test('A30: a current session or login signature is not a password reauthentication proof', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), w = privateKeyToAccount(generatePrivateKey())
    await assert.rejects(t.wallets.requestPasswordReauth(user, 'wrong-password', 'bind', w.address,
      randomUUID(), '127.0.0.1'), /INVALID_CREDENTIALS/)
    assert.equal(await t.db.client.walletChallenge.count(), 0)
    await bind(t, user, w)
    const claim = await t.wallets.createLoginChallenge(w.address, '127.0.0.1')
    const sig = await w.signMessage({ message: claim.message })
    await assert.rejects(t.wallets.verifyLogin(claim.id, claim.message.replace(origin, 'https://evil.invalid'),
      sig, '127.0.0.1'), /INVALID_CREDENTIALS/)
    const signedIn = await t.wallets.verifyLogin(claim.id, claim.message, sig, '127.0.0.1')
    assert.equal(signedIn.authMethod, 'wallet_siwe')
    await assert.rejects(t.wallets.verifyLogin(claim.id, claim.message, sig, '127.0.0.1'), /INVALID_CREDENTIALS/)
  } finally { await t.close() }
})

test('A28: unknown ledger completion blocks use; response retry completes the recorded operation once', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), w = privateKeyToAccount(generatePrivateKey()), key = randomUUID()
    const proof = await t.wallets.requestPasswordReauth(user, password, 'bind', w.address, key, '127.0.0.1')
    const challenge = await t.wallets.createActionChallenge(user, proof.id, 'bind', w.address, key)
    const signature = await w.signTypedData(challenge.typedData)
    const commit = t.security.ledger.commit.bind(t.security.ledger)
    t.security.ledger.commit = async () => { throw new Error('simulated ledger connection loss') }
    await assert.rejects(t.wallets.consumeActionChallenge(user, challenge.id, signature))
    assert.equal(await t.db.client.walletIdentityEvent.count(), 1)
    await assert.rejects(t.wallets.current(user), /WALLET_UNAVAILABLE/)
    t.security.ledger.commit = commit
    const completed = await t.wallets.consumeActionChallenge(user, challenge.id, signature)
    assert.equal(completed.address, w.address.toLowerCase())
    assert.equal((await t.wallets.current(user)).pendingOperationId, null)
    assert.equal(await t.db.client.walletIdentityEvent.count(), 1)
  } finally { await t.close() }
})

test('A30: typed binding authorizations cannot change their purpose or cross sessions', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), w = privateKeyToAccount(generatePrivateKey()), key = randomUUID()
    const proof = await t.wallets.requestPasswordReauth(user, password, 'bind', w.address, key, '127.0.0.1')
    const c = await t.wallets.createActionChallenge(user, proof.id, 'bind', w.address, key)
    const forged = { ...c.typedData, message: { ...c.typedData.message, purpose: 'payout' } }
    await assert.rejects(t.wallets.consumeActionChallenge(user, c.id, await w.signTypedData(forged)), /INVALID_CREDENTIALS/)
    const anotherSession = await t.login(t.f.buyer)
    const signature = await w.signTypedData(c.typedData)
    await assert.rejects(t.wallets.consumeActionChallenge(anotherSession, c.id, signature), /INVALID_CREDENTIALS/)
    assert.equal(await t.db.client.walletIdentityEvent.count(), 0)
    await t.wallets.consumeActionChallenge(user, c.id, signature)
  } finally { await t.close() }
})

test('A30: passwordless identities cannot use their recent session as wallet reauthentication', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), w = privateKeyToAccount(generatePrivateKey())
    await t.db.client.accountCredential.delete({ where: { accountId: user.account.id } })
    await assert.rejects(t.wallets.requestPasswordReauth(user, password, 'bind', w.address,
      randomUUID(), '127.0.0.1'), /INVALID_CREDENTIALS/)
    assert.equal(await t.db.client.walletChallenge.count(), 0)
  } finally { await t.close() }
})

test('A27: recovery epoch changes revoke account sessions, independently of their business state', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer)
    await t.security.client.$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch" = ${randomUUID()}::uuid`
    await assert.rejects(t.auth.authenticate(`bazaar_session=${user.token}`), /UNAUTHENTICATED/)
  } finally { await t.close() }
})

test('wallet sessions cannot bypass security-ledger verification when the feature is disabled', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), w = privateKeyToAccount(generatePrivateKey())
    await bind(t, user, w)
    const c = await t.wallets.createLoginChallenge(w.address, '127.0.0.1')
    const session = await t.wallets.verifyLogin(c.id, c.message, await w.signMessage({ message: c.message }), '127.0.0.1')
    const withoutLedger = new AuthService(t.db.client, t.auth.config)
    await assert.rejects(withoutLedger.authenticate(`bazaar_session=${session.token}`), /WALLET_UNAVAILABLE/)
  } finally { await t.close() }
})

test('account suspension between signature verification and mutation rejects and releases a known rollback', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), w = privateKeyToAccount(generatePrivateKey()), key = randomUUID()
    const proof = await t.wallets.requestPasswordReauth(user, password, 'bind', w.address, key, '127.0.0.1')
    const c = await t.wallets.createActionChallenge(user, proof.id, 'bind', w.address, key)
    const prepare = t.security.ledger.prepare.bind(t.security.ledger)
    t.security.ledger.prepare = async (change) => {
      await t.db.client.account.update({ where: { id: user.account.id }, data: { status: 'disabled' } })
      return prepare(change)
    }
    await assert.rejects(t.wallets.consumeActionChallenge(user, c.id, await w.signTypedData(c.typedData)), /FORBIDDEN|UNAUTHENTICATED/)
    assert.equal(await t.db.client.walletIdentityEvent.count(), 0)
    assert.equal((await t.security.ledger.read(user.account.id, 11155111)).pendingOperationId, null)
  } finally { await t.close() }
})

test('session revocation between signature verification and mutation invalidates the operation', async () => {
  const t = await setup()
  try {
    const user = await t.login(t.f.buyer), w = privateKeyToAccount(generatePrivateKey()), key = randomUUID()
    const proof = await t.wallets.requestPasswordReauth(user, password, 'bind', w.address, key, '127.0.0.1')
    const c = await t.wallets.createActionChallenge(user, proof.id, 'bind', w.address, key)
    const prepare = t.security.ledger.prepare.bind(t.security.ledger)
    t.security.ledger.prepare = async (change) => {
      await t.auth.logout(user)
      return prepare(change)
    }
    await assert.rejects(t.wallets.consumeActionChallenge(user, c.id, await w.signTypedData(c.typedData)), /UNAUTHENTICATED/)
    assert.equal(await t.db.client.walletIdentityEvent.count(), 0)
    assert.equal((await t.security.ledger.read(user.account.id, 11155111)).pendingOperationId, null)
  } finally { await t.close() }
})
