import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sandbox, fixture } from './helpers/database.mjs'

test('A30: current wallet uniqueness and permanent claims survive unbinding', async () => {
  const db = await sandbox()
  try {
    const f = await fixture(db, 'digital')
    const address = '0x' + '1'.repeat(40)
    const wallet = await db.client.walletIdentity.create({ data: {
      accountId: f.buyer, chainId: 11155111, address, bindingVersion: 1, securityRevision: 1n
    } })
    await db.client.walletClaim.create({ data: { chainId: 11155111, address, accountId: f.buyer } })
    await assert.rejects(db.client.walletIdentity.create({ data: {
      accountId: f.other, chainId: 11155111, address, bindingVersion: 1, securityRevision: 1n
    } }), /Unique constraint/)
    await db.client.walletIdentity.update({ where: { id: wallet.id },
      data: { address: null, bindingVersion: 2, securityRevision: 2n } })
    await assert.rejects(db.client.walletClaim.create({ data: {
      chainId: 11155111, address, accountId: f.other
    } }), /Unique constraint/)
    assert.equal((await db.client.walletClaim.findUniqueOrThrow({
      where: { chainId_address: { chainId: 11155111, address } }
    })).accountId, f.buyer)
    await assert.rejects(db.client.walletIdentity.create({ data: {
      accountId: f.buyer, chainId: 11155111, address: '0x' + '2'.repeat(40), bindingVersion: 3,
      securityRevision: 3n
    } }), /Unique constraint/)
  } finally { await db.close() }
})

test('A27: business schema contains projection only, never the authoritative wallet security ledger', async () => {
  const db = await sandbox()
  try {
    const rows = await db.client.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`
    assert(rows.some((r) => r.tablename === 'WalletIdentity'))
    assert(rows.every((r) => r.tablename !== 'WalletSecurityLedger'))
    const f = await fixture(db, 'digital')
    const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
    const order = await db.client.order.findUniqueOrThrow({ where: { id: orderId } })
    assert.equal(order.settlementMode, 'simulated')
  } finally { await db.close() }
})
