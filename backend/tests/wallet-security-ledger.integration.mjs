import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { PostgresWalletSecurityLedger } from '../dist/auth/postgres-wallet-security-ledger.js'

const wallet = (n) => '0x' + String(n).repeat(40)
const change = (t, accountId, address, revision = '0', bindingVersion = 0) => ({
  operationId: randomUUID(), operation: address ? 'bind' : 'unbind', accountId,
  chainId: 11155111, expectedRecoveryEpoch: t.epoch, expectedRevision: revision, expectedBindingVersion: bindingVersion,
  address, payout: null, requestHash: 'a'.repeat(64)
})

test('F01/A27: authoritative identity survives business projection rollback and permanent claims prevent another account', async () => {
  const t = await isolatedLedger()
  try {
    const accountId = randomUUID(), other = randomUUID()
    const one = change(t, accountId, wallet(1))
    await t.ledger.prepare(one)
    const w1 = await t.ledger.commit(one.operationId)
    const oldBusinessBackup = JSON.parse(JSON.stringify(w1))
    const two = change(t, accountId, wallet(2), '1', 1)
    await t.ledger.prepare(two)
    const w2 = await t.ledger.commit(two.operationId)
    assert.equal(w2.address, wallet(2))
    assert.equal(w2.bindingVersion, 2)
    await assert.rejects(t.ledger.assertProjection(oldBusinessBackup), /WALLET_UNAVAILABLE/)
    await assert.rejects(t.ledger.prepare(change(t, other, wallet(1))), /ACCOUNT_LINK_REQUIRED/)
    assert.equal(await t.ledger.claimOwner(11155111, wallet(1)), accountId)
    assert.deepEqual(await t.ledger.commit(two.operationId), w2)
  } finally { await t.close() }
})

test('F01/A28: unresolved prepares block identity use and concurrent claims; only known rollback may abort', async () => {
  const t = await isolatedLedger()
  try {
    const id = randomUUID(), c = change(t, id, wallet(3))
    await t.ledger.prepare(c)
    assert.equal((await t.ledger.read(id, 11155111)).pendingOperationId, c.operationId)
    await assert.rejects(t.ledger.assertProjection({ accountId: id, chainId: 11155111,
      address: null, bindingVersion: 0, revision: '0' }), /WALLET_UNAVAILABLE/)
    await assert.rejects(t.ledger.prepare(change(t, randomUUID(), wallet(3))), /ACCOUNT_LINK_REQUIRED/)
    await t.ledger.abort(c.operationId)
    assert.equal((await t.ledger.read(id, 11155111)).pendingOperationId, null)
    await t.ledger.prepare(change(t, randomUUID(), wallet(3)))
  } finally { await t.close() }
})

test('F01/A30: unbinding does not erase prior ownership and ledger identity mismatch fails closed', async () => {
  const t = await isolatedLedger()
  try {
    const id = randomUUID(), c = change(t, id, wallet(4))
    await t.ledger.prepare(c)
    await t.ledger.commit(c.operationId)
    const unbind = change(t, id, null, '1', 1)
    await t.ledger.prepare(unbind)
    await t.ledger.commit(unbind.operationId)
    assert.equal(await t.ledger.claimOwner(11155111, wallet(4)), id)
    assert.equal((await t.ledger.read(id, 11155111)).address, null)
    const wrong = new PostgresWalletSecurityLedger(t.client, randomUUID())
    await assert.rejects(wrong.recoveryEpoch(), /WALLET_UNAVAILABLE/)
  } finally { await t.close() }
})

test('payout preparation retries compare JSONB values independently of property ordering', async () => {
  const t = await isolatedLedger()
  try {
    const id = randomUUID(), c = change(t, id, wallet(5))
    await t.ledger.prepare(c)
    await t.ledger.commit(c.operationId)
    const payout = { ...change(t, id, wallet(5), '1', 1), operation: 'payout',
      payout: { wallet: wallet(5), escrow: wallet(6), confirmationId: randomUUID() } }
    await t.ledger.prepare(payout)
    assert.equal((await t.ledger.prepare(payout)).pendingOperationId, payout.operationId)
    await t.ledger.commit(payout.operationId)
    assert.equal((await t.ledger.prepare(payout)).payout.confirmationId, payout.payout.confirmationId)
  } finally { await t.close() }
})

test('A30: concurrent cross-account claims have exactly one winner', async () => {
  const t = await isolatedLedger()
  try {
    const one = change(t, randomUUID(), wallet(7)), two = change(t, randomUUID(), wallet(7))
    const results = await Promise.allSettled([t.ledger.prepare(one), t.ledger.prepare(two)])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const rejected = results.find((r) => r.status === 'rejected')
    assert.match(rejected.reason.message, /ACCOUNT_LINK_REQUIRED/)
    const winner = results[0].status === 'fulfilled' ? one : two
    await t.ledger.commit(winner.operationId)
    assert.equal(await t.ledger.claimOwner(11155111, wallet(7)), winner.accountId)
  } finally { await t.close() }
})

test('A27/A28: an old recovery epoch cannot prepare or finish an unresolved operation', async () => {
  const t = await isolatedLedger()
  try {
    const c = change(t, randomUUID(), wallet(8))
    await t.ledger.prepare(c)
    await t.client.$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch" = ${randomUUID()}::uuid`
    await assert.rejects(t.ledger.commit(c.operationId), /WALLET_UNAVAILABLE/)
    await assert.rejects(t.ledger.prepare(change(t, randomUUID(), wallet(9))), /WALLET_UNAVAILABLE/)
    assert.equal((await t.ledger.read(c.accountId, 11155111)).pendingOperationId, c.operationId)
  } finally { await t.close() }
})

test('A27: a read-only ledger source is not trusted for wallet identity reads', async () => {
  const t = await isolatedLedger()
  try {
    const readOnly = new Proxy(t.client, { get(target, name) {
      if (name === '$transaction') return work => target.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        return work(tx)
      })
      return Reflect.get(target, name)
    } })
    const ledger = new PostgresWalletSecurityLedger(readOnly, t.id)
    await assert.rejects(ledger.recoveryEpoch(), /WALLET_UNAVAILABLE/)
  } finally { await t.close() }
})
