import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { fixture, sandbox } from './helpers/database.mjs'
import { startOrderExpiry } from '../dist/orders/order-expiry.js'

let db
before(async () => { db = await sandbox() })
after(async () => { await db?.close() })

test('pending payment expiry releases physical inventory and records a system event', async () => {
  const f = await fixture(db)
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)

  const result = await db.market.expirePendingPaymentOrders(new Date(Date.now() + 60 * 60 * 1000))
  assert.deepEqual(result, { expired: [orderId], scanned: 1 })
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'expired')
  assert.deepEqual(
    await db.client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })
      .then(({ availability, activeOrderId }) => ({ availability, activeOrderId })),
    { availability: 'available', activeOrderId: null }
  )
  assert.equal((await db.client.inventoryReservation.findUniqueOrThrow({ where: { orderId: orderId } })).state, 'expired')
  const event = await db.client.orderEvent.findFirstOrThrow({ where: { orderId, operation: 'expire' } })
  assert.equal(event.toState, 'expired')
  assert.equal(event.actorId, null)
  assert.equal(await db.client.idempotencyRecord.count({ where: { operation: 'expire' } }), 0)
})

test('expiry releases a single digital entitlement and skips fresh orders', async () => {
  const f = await fixture(db, 'digital')
  await db.client.digitalInventory.create({ data: { listingId: f.listing.id } })
  const oldId = await db.market.create(f.buyer, randomUUID(), f.input)
  const cutoff = new Date()
  const fresh = await fixture(db, 'digital')
  await db.client.digitalInventory.create({ data: { listingId: fresh.listing.id } })
  const freshId = await db.market.create(fresh.buyer, randomUUID(), fresh.input)

  const result = await db.market.expirePendingPaymentOrders(cutoff)
  assert.deepEqual(result.expired, [oldId])
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: freshId } })).status, 'pending_payment')
  assert.equal((await db.client.digitalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })).availability, 'available')
  assert.equal((await db.client.digitalInventory.findUniqueOrThrow({ where: { listingId: fresh.listing.id } })).availability, 'reserved')
})

test('expiry and payment race resolves once without duplicate audit events', async () => {
  const f = await fixture(db)
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  const [expiry, payment] = await Promise.allSettled([
    db.market.expirePendingPaymentOrders(new Date(Date.now() + 60 * 60 * 1000)),
    db.market.act(f.buyer, randomUUID(), orderId, 'pay')
  ])
  assert.equal(expiry.status, 'fulfilled')
  const order = await db.client.order.findUniqueOrThrow({ where: { id: orderId } })
  assert.ok(['expired', 'pending_delivery'].includes(order.status))
  assert.equal(payment.status, order.status === 'expired' ? 'rejected' : 'fulfilled')
  assert.equal(await db.client.orderEvent.count({ where: { orderId, operation: 'expire' } }), order.status === 'expired' ? 1 : 0)
  assert.equal(await db.client.settlementRecord.count({ where: { orderId, operation: 'payment' } }), order.status === 'pending_delivery' ? 1 : 0)
})

test('scheduled expiry runs without a manual command and stops cleanly', async () => {
  const f = await fixture(db, 'digital')
  await db.client.digitalInventory.create({ data: { listingId: f.listing.id } })
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  const stop = startOrderExpiry(db.client, { ageMs: 1, intervalMs: 10 })
  try {
    let status = 'pending_payment'
    const deadline = Date.now() + 3000
    while (status !== 'expired' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      status = (await db.client.order.findUniqueOrThrow({ where: { id: orderId } })).status
    }
    assert.equal(status, 'expired')
    assert.equal(await db.client.orderEvent.count({ where: { orderId, operation: 'expire', actorId: null } }), 1)
  } finally {
    stop()
  }
})
