import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { sandbox } from './helpers/database.mjs'

test('home sections use the full published catalog with bounded type-specific reads', async () => {
  const db = await sandbox()
  let app
  try {
    const seller = await db.client.account.create({
      data: { loginName: `seller-${randomUUID()}`, displayName: 'Home seller' }
    })
    const digitalId = randomUUID()
    await db.client.listing.create({
      data: {
        id: digitalId,
        sellerId: seller.id,
        type: 'digital',
        title: 'Digital item',
        description: 'A real digital listing in the test database',
        category: 'digital_assets',
        priceAmount: '10',
        currency: 'USD',
        createdAt: new Date('2026-01-01T00:00:00Z')
      }
    })
    const physical = Array.from({ length: 25 }, (_, index) => ({
      id: randomUUID(),
      sellerId: seller.id,
      type: 'physical',
      title: `Physical item ${index}`,
      description: 'A real physical listing in the test database',
      category: 'electronics',
      priceAmount: '20',
      currency: 'USD',
      createdAt: new Date(Date.UTC(2026, 0, 2, 0, index))
    }))
    await db.client.listing.createMany({ data: physical })
    await db.client.physicalInventory.createMany({
      data: physical.map((listing) => ({ listingId: listing.id }))
    })
    app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false)
    const response = await app.inject({
      method: 'POST',
      url: '/api/listings/home',
      headers: { origin: 'http://localhost:3000' },
      payload: {}
    })
    assert.equal(response.statusCode, 200, response.body)
    const home = response.json()
    assert.equal(home.featured.length, 10)
    assert.equal(home.digital.length, 1)
    assert.equal(home.digital[0].id, digitalId)
    assert.equal(home.physical.length, 5)
    assert.deepEqual(home.physical.map((item) => item.id), physical.slice(-5).reverse().map((item) => item.id))
    assert.equal(home.featured[0].id, physical.at(-1).id)
    assert.ok(home.featured.every((item) => item.publicationStatus === 'published'))

    const indexes = await db.client.$queryRaw`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'Listing'
        AND indexname = 'Listing_publicationStatus_type_createdAt_id_idx'
    `
    assert.equal(indexes.length, 1)
    assert.match(indexes[0].indexdef, /\("publicationStatus", type, "createdAt", id\)/)
  } finally {
    await app?.close()
    await db.close()
  }
})
