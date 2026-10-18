import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'

const config = readConfig()
const manifest = JSON.parse(await readFile(
  resolve(import.meta.dirname, '../../images/sources.json'), 'utf8'
))
const hashes = new Map(manifest.map((item) => [`${item.category}:${item.position}`, item.sha256]))
const db = new DatabaseService(config.databaseUrl, config.databasePool)
await db.onModuleInit()
const app = await createApp(config, false)
const report = { publishedTest: 0, illustrated: 0, lockedUnchanged: 0,
  mediaVerified: 0, otherPublished: 0, nonPublishedWithMedia: 0, unattachedReadyAssets: 0 }
try {
  const all = []
  for (let page = 1; ; page++) {
    const response = await app.inject({
      method: 'POST', url: '/api/listings/search',
      headers: { origin: config.appOrigin },
      payload: { page: String(page), limit: '50', sort: 'newest' }
    })
    assert.equal(response.statusCode, 200)
    all.push(...response.json().items)
    if (!response.json().hasMore) break
  }
  const accounts = await db.client.account.findMany({
    where: { id: { in: [...new Set(all.map((item) => item.seller.id))] } },
    select: { id: true, loginName: true }
  })
  const testSellers = new Set(accounts.filter((account) =>
    /^v2-stress(?:-r2)?_seller_[1-6]@test\.com$/.test(account.loginName))
    .map((account) => account.id))
  for (const item of all) {
    if (!testSellers.has(item.seller.id) || !item.description.startsWith('V2 seeded description ')) {
      report.otherPublished++
      continue
    }
    report.publishedTest++
    const hasOrder = await db.client.order.count({ where: { listingId: item.id } }) > 0
    if (item.saleMode === 'one_off' && hasOrder) {
      assert.equal(item.media.length, 0, `Locked listing changed: ${item.id}`)
      report.lockedUnchanged++
      continue
    }
    assert.equal(item.media.length, 2, `Missing image: ${item.id}`)
    assert.ok(item.description.includes('示意图说明：图片仅展示商品类别'))
    report.illustrated++
    for (const [index, media] of item.media.entries()) {
      const response = await app.inject({ method: 'GET', url: media.url })
      assert.equal(response.statusCode, 200, `Media unavailable: ${item.id}`)
      assert.equal(response.headers['content-type'], 'image/jpeg')
      assert.equal(createHash('sha256').update(response.rawPayload).digest('hex'),
        hashes.get(`${item.category}:${index}`), `Wrong category image: ${item.id}`)
      report.mediaVerified++
    }
  }
  report.nonPublishedWithMedia = await db.client.listingMedia.count({
    where: { listing: { publicationStatus: { not: 'published' } } }
  })
  report.unattachedReadyAssets = await db.client.mediaAsset.count({
    where: { status: 'ready', listingRows: { none: {} }, orderRows: { none: {} } }
  })
  assert.equal(report.nonPublishedWithMedia, 0)
  console.log(JSON.stringify(report))
} finally {
  await app.close()
  await db.onModuleDestroy()
}
