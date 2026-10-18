import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import { OrphanService } from '../dist/media/orphan.service.js'
import { MediaService } from '../dist/media/media.service.js'
import { sandbox } from './helpers/database.mjs'

test('hot copy retires only after every reader moves to cold and the grace period passes', async () => {
  const db = await sandbox()
  try {
    const seller = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Seller' }
    })
    const buyer = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Buyer' }
    })
    const bytes = Buffer.from('a verified immutable image fixture')
    const asset = await db.client.mediaAsset.create({ data: {
      sellerId: seller.id, uploadKey: `staging/${randomUUID()}`,
      hotKey: `assets/${randomUUID()}`, coldKey: `archive/${randomUUID()}`,
      status: 'ready', contentType: 'image/png', declaredBytes: bytes.length,
      actualBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      verifiedAt: new Date('2025-01-01T00:00:00Z')
    } })
    const listing = await db.client.listing.create({ data: {
      sellerId: seller.id, type: 'digital', saleMode: 'repeatable',
      title: 'Service', description: 'Service with history',
      category: 'digital_assets', priceAmount: '3', currency: 'USD'
    } })
    await db.client.listingMedia.create({ data: {
      listingId: listing.id, mediaId: asset.id, position: 0
    } })
    const order = await db.client.order.create({ data: {
      listingId: listing.id, buyerId: buyer.id, sellerId: seller.id,
      status: 'completed', completedAt: new Date('2025-01-01T00:00:00Z')
    } })
    await db.client.orderMediaSnapshot.create({ data: {
      orderId: order.id, mediaId: asset.id, position: 0,
      storageTier: 'cold', archivedAt: new Date('2025-01-02T00:00:00Z')
    } })
    const pendingOrder = await db.client.order.create({ data: {
      listingId: listing.id, buyerId: buyer.id, sellerId: seller.id,
      status: 'completed', completedAt: new Date('2025-01-01T00:00:00Z')
    } })
    await db.client.orderMediaSnapshot.create({ data: {
      orderId: pendingOrder.id, mediaId: asset.id, position: 0, storageTier: 'hot'
    } })
    const deleted = []
    let corruptCold = false
    const cleanup = new OrphanService(db.client, {
      readCold: async () => ({ bytes: corruptCold ? Buffer.from('corrupt') : bytes,
        contentType: 'image/png' }),
      deleteHot: async (key) => { deleted.push(key) }
    })
    const now = new Date('2025-01-04T00:00:00Z')
    assert.deepEqual(await cleanup.retireUnusedHot(now), { retired: 0, failed: 0 })
    await db.client.listingMedia.deleteMany({ where: { listingId: listing.id } })
    assert.deepEqual(await cleanup.retireUnusedHot(new Date('2025-01-02T12:00:00Z')),
      { retired: 0, failed: 0 })
    assert.deepEqual(await cleanup.retireUnusedHot(now), { retired: 0, failed: 0 })
    await db.client.orderMediaSnapshot.update({
      where: { orderId_mediaId: { orderId: pendingOrder.id, mediaId: asset.id } },
      data: { storageTier: 'cold', archivedAt: new Date('2025-01-02T00:00:00Z') }
    })
    corruptCold = true
    assert.deepEqual(await cleanup.retireUnusedHot(now), { retired: 0, failed: 1 })
    assert.deepEqual(deleted, [])
    corruptCold = false
    assert.deepEqual(await cleanup.retireUnusedHot(now), { retired: 1, failed: 0 })
    assert.deepEqual(deleted, [asset.hotKey])
    const retired = await db.client.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })
    assert.equal(retired.status, 'cold_only')
    assert.equal(retired.hotKey, null)
    assert.equal(retired.coldKey, asset.coldKey)
    const reader = new MediaService(db.client, {
      readCold: async () => ({ bytes, contentType: 'image/png' })
    })
    assert.deepEqual((await reader.readOrder(order.id, asset.id, buyer.id)).bytes, bytes)
    assert.deepEqual((await reader.readOrder(pendingOrder.id, asset.id, seller.id)).bytes, bytes)
  } finally {
    await db.close()
  }
})
