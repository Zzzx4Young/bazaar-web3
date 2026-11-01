import { exampleCommitment } from '../scripts/example-commitment.mjs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sandbox } from './helpers/database.mjs'
import { fixtureMediaAsset } from './helpers/media.mjs'

const rejectedByConstraint = (error) =>
  error.meta?.driverAdapterError?.cause?.originalCode === '23514' ||
  error.meta?.code === '23514'

test('verified media content and ordered order snapshots cannot be rewritten or removed', async () => {
  const db = await sandbox()
  try {
    const seller = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Seller' }
    })
    const buyer = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Buyer' }
    })
    const media = await fixtureMediaAsset(db, seller.id)
    const listing = await db.client.listing.create({ data: {
      sellerId: seller.id, type: 'digital', commitment: exampleCommitment('digital'),
      commitmentVersion: 1, saleMode: 'repeatable', title: 'History',
      description: 'Original history', category: 'digital_assets',
      priceAmount: '3', currency: 'USD'
    } })
    await db.client.listingMedia.create({ data: {
      listingId: listing.id, mediaId: media.id, position: 0
    } })
    const orderId = await db.market.create(buyer.id, randomUUID(), {
      listingId: listing.id, version: 1
    })
    await assert.rejects(db.client.mediaAsset.update({
      where: { id: media.id }, data: { sha256: 'b'.repeat(64) }
    }), rejectedByConstraint)
    await assert.rejects(db.client.mediaAsset.update({
      where: { id: media.id }, data: { hotKey: `assets/${randomUUID()}` }
    }), rejectedByConstraint)
    await assert.rejects(db.client.orderMediaSnapshot.update({
      where: { orderId_mediaId: { orderId, mediaId: media.id } },
      data: { position: 1 }
    }), rejectedByConstraint)
    const replacement = await fixtureMediaAsset(db, seller.id)
    await assert.rejects(db.client.orderMediaSnapshot.update({
      where: { orderId_mediaId: { orderId, mediaId: media.id } },
      data: { mediaId: replacement.id }
    }), rejectedByConstraint)
    await assert.rejects(db.client.orderMediaSnapshot.delete({
      where: { orderId_mediaId: { orderId, mediaId: media.id } }
    }), rejectedByConstraint)
    const archivedAt = new Date()
    await db.client.mediaAsset.update({
      where: { id: media.id }, data: { coldKey: `archive/${randomUUID()}` }
    })
    await db.client.orderMediaSnapshot.update({
      where: { orderId_mediaId: { orderId, mediaId: media.id } },
      data: { storageTier: 'cold', archivedAt }
    })
    await assert.rejects(db.client.orderMediaSnapshot.update({
      where: { orderId_mediaId: { orderId, mediaId: media.id } },
      data: { archivedAt: new Date(archivedAt.getTime() + 1000) }
    }), rejectedByConstraint)
    assert.equal((await db.client.orderMediaSnapshot.findUniqueOrThrow({
      where: { orderId_mediaId: { orderId, mediaId: media.id } }
    })).archivedAt?.getTime(), archivedAt.getTime())
  } finally {
    await db.close()
  }
})
