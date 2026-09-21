import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { fixture, sandbox } from './helpers/database.mjs'

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
  assert.equal((await db.client.orderEvent.findFirstOrThrow({ where: { orderId, operation: 'expire' } })).toState, 'expired')
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
