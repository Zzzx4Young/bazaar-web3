import { randomUUID } from 'node:crypto'

// Contract fixtures only; browser/media integration tests use real Garage objects.
export async function fixtureMediaAsset(db, sellerId) {
  const nonce = randomUUID()
  return db.client.mediaAsset.create({
    data: {
      sellerId,
      uploadKey: `fixture/staging/${nonce}`,
      hotKey: `fixture/assets/${nonce}`,
      status: 'ready',
      contentType: 'image/png',
      declaredBytes: 20,
      actualBytes: 20,
      sha256: 'a'.repeat(64),
      verifiedAt: new Date()
    }
  })
}
