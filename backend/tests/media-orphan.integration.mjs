import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { OrphanService } from '../dist/media/orphan.service.js'
import { sandbox } from './helpers/database.mjs'

test('stale pending uploads are expired and failed object deletes retry safely', async () => {
  const db = await sandbox()
  try {
    const seller = await db.client.account.create({
      data: { loginName: randomUUID(), displayName: 'Seller' }
    })
    const uploadKey = `staging/${seller.id}/${randomUUID()}`
    const asset = await db.client.mediaAsset.create({ data: {
      sellerId: seller.id, uploadKey, status: 'pending', contentType: 'image/png',
      declaredBytes: 123, createdAt: new Date('2025-01-01T00:00:00Z')
    } })
    let attempts = 0
    const service = new OrphanService(db.client, {
      deleteHot: async (key) => {
        assert.equal(key, uploadKey)
        if (++attempts === 1) throw new Error('Garage unavailable')
      }
    })
    assert.deepEqual(await service.expirePending(new Date('2025-01-03T00:00:00Z')),
      { expired: 1, failed: 1 })
    assert.equal((await db.client.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status,
      'expired')
    assert.deepEqual(await service.expirePending(new Date('2025-01-03T00:00:00Z')),
      { expired: 0, failed: 0 })
    assert.equal(attempts, 2)
    assert.equal((await db.client.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status,
      'discarded')
  } finally {
    await db.close()
  }
})
