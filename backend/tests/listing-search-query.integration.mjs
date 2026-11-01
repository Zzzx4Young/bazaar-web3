import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { mock } from 'node:test'
import pg from 'pg'
import { ListingService } from '../dist/listings/listing.service.js'
import { RatesService } from '../dist/pricing/rates.service.js'
import { sandbox } from './helpers/database.mjs'
import { fixtureMediaAsset } from './helpers/media.mjs'

test('search returns real detail fields and empty-page totals with one database round trip', async () => {
  const db = await sandbox()
  try {
    const seller = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Real seller' }
    })
    const other = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Other seller' }
    })
    const timestamp = new Date('2026-10-01T12:34:56.789Z')
    const rows = []
    for (const [index, type] of ['physical', 'digital', 'digital', 'physical'].entries()) {
      const row = await db.client.listing.create({
        data: {
          sellerId: index === 3 ? other.id : seller.id,
          type,
          category: type === 'physical' ? 'electronics' : 'digital_assets',
          title: `Persisted ${index}`,
          description: 'Stored description',
          priceAmount: index === 1 ? '0.00000001' : '123456789012345678.12',
          currency: index === 1 ? 'BTC' : 'USD',
          createdAt: timestamp,
          ...(type === 'digital'
            ? { licenseDescription: 'Stored license', contentVersion: 'v2' }
            : {})
        }
      })
      rows.push(row)
    }
    await db.client.physicalInventory.createMany({
      data: rows.filter((r) => r.type === 'physical').map((r) => ({ listingId: r.id }))
    })
    await db.client.digitalInventory.create({ data: { listingId: rows[1].id } })
    const media = await fixtureMediaAsset(db, seller.id)
    await db.client.listingMedia.create({
      data: { listingId: rows[1].id, mediaId: media.id, position: 0 }
    })
    const service = new ListingService(
      db.client,
      new RatesService(db.client, async () => {
        throw new Error('Newest must not load rates')
      })
    )
    const expected = await Promise.all(
      [...rows].sort((a, b) => b.id.localeCompare(a.id)).map((r) => service.detail(r.id))
    )
    const query = pg.Client.prototype.query
    let roundTrips = 0
    const trace = mock.method(pg.Client.prototype, 'query', function (...args) {
      roundTrips++
      return query.apply(this, args)
    })
    try {
      const page = await service.list({ limit: '2' })
      assert.deepEqual(
        JSON.parse(JSON.stringify(page.items)),
        JSON.parse(JSON.stringify(expected.slice(0, 2)))
      )
      assert.equal(page.total, 4)
      assert.equal(page.hasMore, true)
      assert.equal(page.quote, null)
      assert.equal(
        roundTrips,
        1,
        'A page must not hold a pool connection across multiple query round trips'
      )
      roundTrips = 0
      const second = await service.list({ page: '2', limit: '2' })
      assert.deepEqual(
        [...page.items, ...second.items].find((item) => item.id === rows[1].id)?.media,
        [{ id: media.id, position: 0, url: `/api/listings/${rows[1].id}/media/${media.id}` }]
      )
      assert.deepEqual(
        JSON.parse(JSON.stringify(second.items)),
        JSON.parse(JSON.stringify(expected.slice(2)))
      )
      assert.equal(second.total, 4)
      assert.equal(second.hasMore, false)
      assert.equal(roundTrips, 1)
      roundTrips = 0
      const empty = await service.list({ page: '20', limit: '2' })
      assert.deepEqual(empty.items, [])
      assert.equal(empty.total, 4)
      assert.equal(empty.hasMore, false)
      assert.equal(roundTrips, 1)
      const privatePage = await service.list({}, seller.id)
      assert.equal(privatePage.total, 3)
      assert.ok(privatePage.items.every((item) => item.seller.id === seller.id))
      assert.ok(!JSON.stringify(privatePage).includes('loginName'))
    } finally {
      trace.mock.restore()
    }
  } finally {
    await db.close()
  }
})

test('single-currency price sorting and later pages do not require an FX quote', async () => {
  const db = await sandbox()
  try {
    const seller = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Single-currency seller' }
    })
    const cny = []
    for (const amount of ['9', '27', '14']) {
      cny.push(await db.client.listing.create({ data: {
        sellerId: seller.id, type: 'digital', saleMode: 'repeatable',
        title: `CNY ${amount}`, description: 'Single-currency sort fixture',
        category: 'digital_assets', priceAmount: amount, currency: 'CNY'
      } }))
    }
    await db.client.listing.create({ data: {
      sellerId: seller.id, type: 'digital', saleMode: 'repeatable',
      title: 'USD 1', description: 'Different currency',
      category: 'digital_assets', priceAmount: '1', currency: 'USD'
    } })
    let loads = 0
    const service = new ListingService(db.client, new RatesService(db.client, async () => {
      loads++
      throw new Error('FX provider unavailable')
    }))
    const first = await service.list({ sort: 'price_desc', currency: 'CNY', limit: '2' })
    assert.deepEqual(first.items.map((item) => item.id), [cny[1].id, cny[2].id])
    assert.equal(first.total, 3)
    assert.equal(first.hasMore, true)
    assert.equal(first.quote, null)
    assert.ok(first.items.every((item) => item.priceUsd === null))
    const second = await service.list({
      sort: 'price_desc', currency: 'CNY', limit: '2', page: '2'
    })
    assert.deepEqual(second.items.map((item) => item.id), [cny[0].id])
    assert.equal(second.quote, null)
    assert.equal(loads, 0)
    await assert.rejects(service.list({ sort: 'price_desc' }),
      (error) => error.code === 'FX_UNAVAILABLE')
    assert.equal(loads, 1)
  } finally {
    await db.close()
  }
})
