import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'
import { ArchiveService, readArchiveDays } from '../dist/media/archive.service.js'
import { sandbox } from './helpers/database.mjs'

const secret = (name) => readFileSync(new URL(`../../infra/.secrets/garage-app/${name}`, import.meta.url), 'utf8').trim()
const credentials = (tier) => ({ accessKeyId: secret(`${tier}_access_key_id`), secretAccessKey: secret(`${tier}_secret_key`) })

test('shortened archive policy moves only due completed orders and preserves shared hot readers', async () => {
  const db = await sandbox()
  const store = new GarageObjectStore({
    hotEndpoint: 'http://127.0.0.1:3900', hotPublicEndpoint: 'http://127.0.0.1:3900',
    coldEndpoint: 'http://127.0.0.1:3903', hotCredentials: credentials('hot'),
    coldCredentials: credentials('cold'), hotBucket: 'bazaar-hot', coldBucket: 'bazaar-cold'
  })
  const bytes = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex')
  const key = `archive-test/${randomUUID()}`
  let coldKey
  try {
    const seller = await db.client.account.create({ data: { loginName: randomUUID(), displayName: 'Seller' } })
    const buyer = await db.client.account.create({ data: { loginName: randomUUID(), displayName: 'Buyer' } })
    const other = await db.client.account.create({ data: { loginName: randomUUID(), displayName: 'Other' } })
    await store.putHot(key, bytes, 'image/png')
    const asset = await db.client.mediaAsset.create({ data: {
      sellerId: seller.id, uploadKey: `archive-test/staging/${randomUUID()}`,
      hotKey: key, status: 'ready', contentType: 'image/png',
      declaredBytes: bytes.length, actualBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), verifiedAt: new Date()
    } })
    const listing = await db.client.listing.create({ data: {
      sellerId: seller.id, type: 'digital', saleMode: 'repeatable', title: 'Archive test',
      description: 'Shared image', category: 'digital_assets', priceAmount: '3', currency: 'USD'
    } })
    await db.client.listingMedia.create({ data: { listingId: listing.id, mediaId: asset.id, position: 0 } })
    const first = await db.market.create(buyer.id, randomUUID(), { listingId: listing.id, version: 1 })
    const second = await db.market.create(other.id, randomUUID(), { listingId: listing.id, version: 1 })
    const recent = await db.market.create(buyer.id, randomUUID(), { listingId: listing.id, version: 1 })
    const now = new Date('2026-10-17T00:00:00.000Z')
    assert.equal(readArchiveDays(undefined), 90)
    const testArchiveDays = readArchiveDays('1')
    const terminalOrders = []
    for (const status of ['cancelled', 'expired', 'refunded']) {
      const id = await db.market.create(buyer.id, randomUUID(), {
        listingId: listing.id, version: 1
      })
      await db.client.order.update({ where: { id }, data: { status } })
      terminalOrders.push(id)
    }
    await db.client.order.update({ where: { id: first }, data: {
      status: 'completed', completedAt: new Date(now.getTime() - 2 * 86400000)
    } })
    await db.client.order.update({ where: { id: recent }, data: {
      status: 'completed', completedAt: new Date(now.getTime() - 12 * 3600000)
    } })
    const archive = new ArchiveService(db.client, store, testArchiveDays)
    const concurrent = await Promise.all([archive.runOnce(now, 10), archive.runOnce(now, 10)])
    assert.equal(concurrent.reduce((sum, result) => sum + result.archived, 0), 1)
    assert.equal((await archive.runOnce(now, 10)).archived, 0)
    assert.equal((await db.client.orderMediaSnapshot.findUniqueOrThrow({ where: {
      orderId_mediaId: { orderId: first, mediaId: asset.id }
    } })).storageTier, 'cold')
    assert.equal((await db.client.orderMediaSnapshot.findUniqueOrThrow({ where: {
      orderId_mediaId: { orderId: second, mediaId: asset.id }
    } })).storageTier, 'hot')
    assert.equal((await db.client.orderMediaSnapshot.findUniqueOrThrow({ where: {
      orderId_mediaId: { orderId: recent, mediaId: asset.id }
    } })).storageTier, 'hot')
    for (const orderId of terminalOrders)
      assert.equal((await db.client.orderMediaSnapshot.findUniqueOrThrow({ where: {
        orderId_mediaId: { orderId, mediaId: asset.id }
      } })).storageTier, 'hot')
    coldKey = (await db.client.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).coldKey
    assert.ok(coldKey)
    assert.deepEqual((await store.readCold(coldKey)).bytes, bytes)
    assert.deepEqual((await store.readHot(key)).bytes, bytes)
    const retryOrder = await db.market.create(other.id, randomUUID(), { listingId: listing.id, version: 1 })
    await db.client.order.update({ where: { id: retryOrder }, data: {
      status: 'completed', completedAt: new Date(now.getTime() - 2 * 86400000)
    } })
    const failing = new ArchiveService(db.client, {
      readHot: store.readHot.bind(store),
      readCold: async () => { throw new Error('Simulated cold outage') }
    }, testArchiveDays)
    assert.deepEqual(await failing.runOnce(now, 10), { archived: 0, failed: 1 })
    const stillHot = await db.client.orderMediaSnapshot.findUniqueOrThrow({ where: {
      orderId_mediaId: { orderId: retryOrder, mediaId: asset.id }
    } })
    assert.equal(stillHot.storageTier, 'hot')
    assert.equal(stillHot.archiveClaimToken, null)
    assert.deepEqual(await archive.runOnce(now, 10), { archived: 1, failed: 0 })
  } finally {
    await store.deleteHot(key)
    if (coldKey) await store.deleteCold(coldKey)
    await db.close()
  }
})
