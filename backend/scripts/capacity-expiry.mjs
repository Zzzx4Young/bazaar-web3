import { exampleCommitment } from './example-commitment.mjs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { setInterval, clearInterval } from 'node:timers'
import { orderExpiryBatchSize, orderExpiryIntervalMs, pendingPaymentAgeMs } from '../dist/orders/order-expiry-policy.js'

export const capacityExpiryPolicy = Object.freeze({
  orders: orderExpiryBatchSize + 1,
  pollMs: 500,
  minimumSeconds: Math.ceil(2 * orderExpiryIntervalMs / 1000)
})

// Isolated test fixtures only. Production expiry cadence and age are unchanged.
export function capacityExpiry({ client, buyer, sellerId, create, count = capacityExpiryPolicy.orders }) {
  assert.notEqual(buyer.id, sellerId)
  assert.ok(Number.isSafeInteger(count) && count > 0)
  const listings = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), sellerId,
    type: 'physical', commitment: exampleCommitment('physical'), commitmentVersion: 1, category: 'electronics', title: `Expiry capacity fixture ${index}`,
    description: 'Isolated capacity expiry fixture', priceAmount: '10.00', currency: 'USD' }))
  const ids = [], keys = new Map()
  let prepared = false
  let started, timer, pending, failure, firstObservedMs, allObservedMs
  async function isolatedTarget() {
    const [target] = await client.$queryRaw`SELECT current_schema() AS schema, current_database() AS database`
    assert.equal(target.database, 'bazaar_test')
    assert.match(target.schema, /^v2_[0-9a-f]{32}$/)
    return target
  }
  async function sample() {
    if (pending) return pending
    pending = (async () => {
      const expired = await client.order.count({ where: { id: { in: ids }, status: 'expired' } })
      const elapsed = performance.now() - started
      if (expired && firstObservedMs === undefined) firstObservedMs = elapsed
      if (expired === ids.length && allObservedMs === undefined) allObservedMs = elapsed
    })().catch(() => { failure = true }).finally(() => { pending = undefined })
    return pending
  }
  return {
    async prepare() {
      await isolatedTarget()
      await client.listing.createMany({ data: listings })
      await client.physicalInventory.createMany({ data: listings.map(listing => ({ listingId: listing.id })) })
      prepared = true
    },
    async arm() {
      assert.equal(prepared, true)
      assert.equal(ids.length, 0)
      const target = await isolatedTarget()
      const aged = new Date(Date.now() - pendingPaymentAgeMs - orderExpiryIntervalMs).toISOString()
      // Prisma supplies INSERT timestamps. A temporary trigger ages only this
      // workload's UUID listing IDs in the isolated schema; UPDATE protection stays active.
      const listingIds = listings.map(listing => `'${listing.id}'::uuid`).join(',')
      await client.$executeRawUnsafe(`CREATE FUNCTION "${target.schema}".capacity_expiry_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."listingId" = ANY(ARRAY[${listingIds}]) THEN NEW."createdAt" := '${aged}'::timestamptz; END IF; RETURN NEW; END $$`)
      try {
        await client.$executeRawUnsafe(`CREATE TRIGGER capacity_expiry_insert BEFORE INSERT ON "${target.schema}"."Order" FOR EACH ROW EXECUTE FUNCTION "${target.schema}".capacity_expiry_insert()`)
        for (const listing of listings) {
          const key = randomUUID()
          const response = await create({ listingId: listing.id, version: 1,
            shipping: { recipient: 'Expiry fixture', contact: 'virtual', address: 'Expiry fixture address' } }, buyer, key)
          assert.equal(response.status, 200, 'Expiry fixture HTTP creation failed')
          assert.equal(typeof response.value.orderId, 'string')
          assert.ok(!keys.has(response.value.orderId))
          ids.push(response.value.orderId); keys.set(response.value.orderId, key)
        }
      } finally {
        try {
          await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS capacity_expiry_insert ON "${target.schema}"."Order"`)
        } finally {
          await client.$executeRawUnsafe(`DROP FUNCTION "${target.schema}".capacity_expiry_insert()`)
        }
      }
      assert.equal(ids.length, count)
      const timestamps = await client.order.findMany({ where: { id: { in: ids } }, select: { createdAt: true } })
      assert.ok(timestamps.every(order => order.createdAt.getTime() <= Date.parse(aged)),
        'HTTP order INSERT did not use the isolated fixture timestamp')
      assert.equal(await client.order.count({ where: { id: { in: ids }, status: 'expired' } }), 0,
        'Expiry fixtures completed before measured load')
    },
    start(measuredStarted) {
      assert.equal(started, undefined)
      started = measuredStarted
      timer = setInterval(() => { void sample() }, capacityExpiryPolicy.pollMs)
      timer.unref()
    },
    async stop() {
      clearInterval(timer)
      await pending
    },
    async audit(seconds) {
      assert.equal(failure, undefined, 'Expiry observer query failed')
      assert.notEqual(firstObservedMs, undefined, 'No expiry observed during measured load')
      assert.ok(allObservedMs <= seconds * 1000, 'Expiry batch did not finish during measured load')
      const orders = await client.order.findMany({ where: { id: { in: ids } }, include: {
        snapshot: true, shipping: true, eventOrderRows: true, reservationOrderRows: true,
        idempotencyOrderRows: true, orderListing: { include: { inventoryListingRows: true } } } })
      assert.equal(orders.length, count)
      for (const order of orders) {
        assert.equal(order.status, 'expired'); assert.equal(order.version, 2)
        assert.equal(order.buyerId, buyer.id); assert.equal(order.sellerId, sellerId)
        assert.equal(order.snapshot.priceAmount.toFixed(2), '10.00')
        assert.equal(order.snapshot.currency, 'USD')
        assert.equal(order.shipping.address, 'Expiry fixture address')
        assert.equal(order.eventOrderRows.length, 2)
        assert.equal(order.eventOrderRows.filter(event => event.operation === 'create').length, 1)
        const expired = order.eventOrderRows.filter(event => event.operation === 'expire')
        assert.equal(expired.length, 1); assert.equal(expired[0].actorId, null)
        assert.equal(order.reservationOrderRows.length, 1)
        assert.equal(order.reservationOrderRows[0].state, 'expired')
        assert.equal(order.idempotencyOrderRows.length, 1)
        assert.equal(order.idempotencyOrderRows[0].key, keys.get(order.id))
        const inventory = order.orderListing.inventoryListingRows
        assert.equal(inventory.length, 1)
        assert.equal(inventory[0].activeOrderId, null)
        assert.equal(inventory[0].availability, 'available')
        assert.equal(inventory[0].version, 3)
      }
      return { verified: true, orders: count, firstObservedMs, allObservedMs,
        duplicateExpiryEvents: 0, releasedPhysicalItems: count,
        policy: capacityExpiryPolicy,
        scope: 'HTTP-created orders aged by a temporary INSERT trigger scoped to fixture listing IDs in random test schema; trigger removed and immutable identity protection retained; normal API expiry workers; observer queries outside scheduled HTTP arrivals' }
    }
  }
}
