import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildV2SeedPlan,
  V2_LISTING_COUNT,
  V2_ORDER_COUNT,
  assertLoopbackDatabaseUrl,
  seedV2Rates
} from '../scripts/v2-seed.mjs'

test('V2 seed plan covers dense listings, orders, currencies, and edge states', () => {
  const plan = buildV2SeedPlan({ seed: 'test-v2' })

  assert.equal(plan.listings.length, V2_LISTING_COUNT)
  const categoryType = {
    electronics: 'physical', secondhand_fashion: 'physical',
    digital_assets: 'digital', software_source: 'digital', game_items: 'digital'
  }
  assert.ok(plan.listings.every((listing) => categoryType[listing.category] === listing.type))
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
  const ratedSellers = new Set(plan.orders.filter((order) => order.status === 'completed')
    .map((order) => plan.listings.find((listing) => listing.key === order.listingKey)?.sellerKey))
  assert.equal(ratedSellers.size, 6)
  assert.equal(plan.cartCheckouts.length, 3)
  for (const checkout of plan.cartCheckouts) {
    const lines = checkout.orderKeys.map((key) => plan.orders.find((order) => order.key === key))
    assert.equal(lines.length, 3)
    assert.ok(lines.every((order) => order?.buyerKey === checkout.buyerKey))
    assert.equal(new Set(lines.map((order) => plan.listings.find((listing) =>
      listing.key === order?.listingKey)?.sellerKey)).size, 3)
  }
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

test('ordinary development seeds never publish deterministic rate snapshots', async () => {
  const writes = []
  const client = { rateSnapshot: { create: async ({ data }) => { writes.push(data) } } }
  await seedV2Rates(client)
  assert.equal(writes.length, 0)
  await seedV2Rates(client, { fixtureRates: true })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].provider, 'V2 deterministic stress rates')
  const { rateSnapshotTtlMs } = await import('../dist/pricing/rates-policy.js')
  assert.equal(writes[0].expiresAt - writes[0].fetchedAt, rateSnapshotTtlMs)
})

test('V2 seed only accepts loopback PostgreSQL targets', () => {
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl('postgresql://x:y@127.0.0.1:5432/db'))
  assert.throws(() => assertLoopbackDatabaseUrl('postgresql://x:y@db.example/db'), /loopback/)
})
