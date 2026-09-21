import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildV2SeedPlan,
  V2_LISTING_COUNT,
  V2_ORDER_COUNT,
  assertLoopbackDatabaseUrl
} from '../scripts/v2-seed.mjs'

test('V2 seed plan covers dense listings, orders, currencies, and edge states', () => {
  const plan = buildV2SeedPlan({ seed: 'test-v2' })

  assert.equal(plan.listings.length, V2_LISTING_COUNT)
  assert.equal(plan.orders.length, V2_ORDER_COUNT)
  assert.ok(plan.accounts.length >= 12)
  assert.ok(plan.listings.some((listing) => listing.title.length > 100))
  assert.ok(plan.listings.some((listing) => /[\u4e00-\u9fff]/u.test(listing.title)))
  assert.ok(plan.listings.some((listing) => listing.price.currency === 'BTC'))
  assert.ok(plan.listings.some((listing) => listing.price.amount === '0'))
  assert.ok(plan.listings.some((listing) => listing.type === 'digital' && listing.supplyMode === 'single'))
  assert.ok(plan.listings.some((listing) => listing.type === 'digital' && listing.supplyMode === 'unlimited'))
  assert.ok(plan.orders.some((order) => order.status === 'pending_payment' &&
    plan.listings.find((listing) => listing.key === order.listingKey)?.supplyMode === 'single'))
  assert.deepEqual(Object.keys(plan.orderStates).sort(), [
    'cancelled',
    'completed',
    'expired',
    'issue',
    'pending_acceptance',
    'pending_delivery',
    'pending_payment',
    'refunded'
  ])
})

test('V2 seed only accepts loopback PostgreSQL targets', () => {
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl('postgresql://x:y@127.0.0.1:5432/db'))
  assert.throws(() => assertLoopbackDatabaseUrl('postgresql://x:y@db.example/db'), /loopback/)
})
