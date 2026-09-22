import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { OrderCommands } from '../dist/orders/order-commands.js'
import { fixture, sandbox } from './helpers/database.mjs'

let db
before(async () => { db = await sandbox() })
after(async () => { await db?.close() })

async function disputedOrder(price = '12.50') {
  const f = await fixture(db, 'physical', price)
  const admin = await db.client.account.create({
    data: { loginName: randomUUID(), displayName: 'Dispute admin', role: 'admin' }
  })
  const id = await db.market.create(f.buyer, randomUUID(), f.input)
  await db.market.act(f.buyer, randomUUID(), id, 'pay')
  await db.market.act(f.seller, randomUUID(), id, 'deliver', { reference: 'TEST-TRACK' })
  await db.market.act(f.buyer, randomUUID(), id, 'issue', { description: 'Item does not match' })
  await db.market.act(f.buyer, randomUUID(), id, 'request_refund')
  return { ...f, admin: admin.id, id }
}

test('seller counteroffer and admin release pay seller once with immutable audit', async () => {
  const f = await disputedOrder()
  const commands = new OrderCommands(db.client)
  const offerKey = randomUUID()
  await db.market.act(f.seller, offerKey, f.id, 'counteroffer', { description: 'Send replacement item' })
  await db.market.act(f.seller, offerKey, f.id, 'counteroffer', { description: 'Send replacement item' })
  await assert.rejects(
    db.market.act(f.seller, randomUUID(), f.id, 'counteroffer', { description: 'New offer' }),
    (error) => error.code === 'STATE_CONFLICT'
  )
  await assert.rejects(
    commands.resolveDispute(f.other, randomUUID(), f.id, { outcome: 'release' }),
    (error) => error.code === 'FORBIDDEN'
  )
  const key = randomUUID()
  assert.equal(await commands.resolveDispute(f.admin, key, f.id, { outcome: 'release' }), f.id)
  assert.equal(await commands.resolveDispute(f.admin, key, f.id, { outcome: 'release' }), f.id)
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: f.id } })).status, 'completed')
  assert.equal((await db.client.refundRequest.findFirstOrThrow({ where: { orderId: f.id } })).status, 'closed')
  assert.deepEqual(
    (await db.client.settlementRecord.findMany({ where: { orderId: f.id }, orderBy: { operation: 'asc' } }))
      .map((row) => row.operation),
    ['payment', 'release']
  )
  assert.equal((await db.client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })).availability, 'sold')
  assert.equal((await db.client.orderEvent.findFirstOrThrow({ where: { orderId: f.id, operation: 'counteroffer' } })).note, 'Send replacement item')
  assert.equal((await db.client.orderEvent.findFirstOrThrow({ where: { orderId: f.id, operation: 'resolve_release' } })).actorId, f.admin)
  await assert.rejects(
    commands.resolveDispute(f.admin, randomUUID(), f.id, { outcome: 'refund', returnOutcome: 'returned' }),
    (error) => error.code === 'STATE_CONFLICT'
  )
})

test('admin refund restores buyer simulated balance and keeps stock on refund hold', async () => {
  const f = await disputedOrder()
  const commands = new OrderCommands(db.client)
  await db.market.act(f.seller, randomUUID(), f.id, 'counteroffer', { description: 'Offer replacement' })
  await commands.resolveDispute(f.admin, randomUUID(), f.id, { outcome: 'refund', returnOutcome: 'returned' })
  const request = await db.client.refundRequest.findFirstOrThrow({ where: { orderId: f.id } })
  assert.equal(request.status, 'approved')
  assert.equal(request.approvedBy, null)
  assert.equal(request.resolvedBy, f.admin)
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: f.id } })).status, 'refunded')
  assert.equal((await db.client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })).availability, 'refund_hold')
  assert.deepEqual(
    (await db.client.settlementRecord.findMany({ where: { orderId: f.id }, orderBy: { operation: 'asc' } }))
      .map((row) => row.operation),
    ['payment', 'refund']
  )
})

test('free order reaches admin refund without zero-amount settlement rows', async () => {
  const f = await disputedOrder('0')
  const commands = new OrderCommands(db.client)
  await db.market.act(f.seller, randomUUID(), f.id, 'counteroffer', { description: 'Free replacement' })
  await commands.resolveDispute(f.admin, randomUUID(), f.id, { outcome: 'refund', returnOutcome: 'not_required' })
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: f.id } })).status, 'refunded')
  assert.equal(await db.client.settlementRecord.count({ where: { orderId: f.id } }), 0)
  await db.market.act(f.seller, randomUUID(), f.id, 'restore', { inHandAndResellable: true })
  assert.equal((await db.client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })).availability, 'available')
})
