import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'

const apply = process.argv.includes('--apply')
const limitArgument = process.argv.find((arg) => arg.startsWith('--limit='))
const limit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : Infinity
assert.ok(limit === Infinity || (Number.isInteger(limit) && limit > 0))
const url = new URL(process.env.DATABASE_URL ?? '')
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(url.hostname) &&
  url.pathname === '/bazaar_dev' && url.searchParams.get('schema') === 'bazaar',
'Only the loopback bazaar_dev database is allowed')
const config = readConfig()
const root = resolve(import.meta.dirname, '../../images')
const manifest = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
const files = new Map()
for (const source of manifest) {
  const bytes = await readFile(resolve(root, source.filename))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256)
  assert.ok(bytes.length < 5 * 1024 * 1024 && /^CC0(?:\s|$)/i.test(source.license))
  files.set(`${source.category}:${source.position}`, bytes)
}
assert.equal(files.size, 10)

const db = new DatabaseService(config.databaseUrl, config.databasePool)
await db.onModuleInit()
const app = await createApp(config, false)
const origin = config.appOrigin
const password = process.env.V2_SEED_PASSWORD ?? 'V2-Local-Test-Password-2026'
const summary = { publishedTest: 0, locked: 0, alreadyHasMedia: 0, eligible: 0, attached: 0 }

function jsonResponse(response, expectedStatus) {
  if (response.statusCode !== expectedStatus)
    throw new Error(`API ${response.statusCode}: ${response.json().code ?? 'unexpected response'}`)
  return response.json()
}

async function post(path, payload, headers = { origin }) {
  return app.inject({ method: 'POST', url: `/api${path}`, headers, payload })
}

async function allPublished() {
  const items = []
  for (let page = 1; ; page++) {
    const response = jsonResponse(await post('/listings/search', {
      page: String(page), limit: '50', sort: 'newest'
    }), 200)
    items.push(...response.items)
    if (!response.hasMore) break
  }
  return items
}

async function upload(headers, bytes) {
  const intent = jsonResponse(await post('/media/upload-intents', {
    contentType: 'image/jpeg', byteSize: bytes.length
  }, headers), 201)
  const put = await fetch(intent.uploadUrl, {
    method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes
  })
  if (!put.ok) throw new Error(`Garage PUT failed: HTTP ${put.status}`)
  const completed = jsonResponse(await post(`/media/${intent.assetId}/complete`, {}, headers), 200)
  assert.equal(completed.status, 'ready')
  assert.equal(completed.sha256, createHash('sha256').update(bytes).digest('hex'))
  return completed.assetId
}

try {
  const all = await allPublished()
  const sellerIds = [...new Set(all.map((item) => item.seller.id))]
  const accounts = await db.client.account.findMany({
    where: { id: { in: sellerIds } }, select: { id: true, loginName: true }
  })
  const logins = new Map(accounts.filter((account) =>
    /^v2\.stress(?:\.r2)?\.seller\.[1-6]@gmail\.com$/.test(account.loginName))
    .map((account) => [account.id, account.loginName]))
  const published = all.filter((item) => logins.has(item.seller.id) &&
    (item.description?.startsWith('V2 seeded description ') ?? false))
  const ids = published.map((item) => item.id)
  const ordered = await db.client.order.groupBy({
    by: ['listingId'], where: { listingId: { in: ids } }, _count: { id: true }
  })
  const withOrders = new Set(ordered.map((row) => row.listingId))
  const eligible = published.filter((item) => {
    if (item.media.length) { summary.alreadyHasMedia++; return false }
    if (item.saleMode === 'one_off' && withOrders.has(item.id)) {
      summary.locked++
      return false
    }
    return true
  })
  summary.publishedTest = published.length
  summary.eligible = eligible.length
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summary }))
  if (!apply) process.exitCode = 0
  else {
    const bySeller = Object.groupBy(eligible, (item) => item.seller.id)
    for (const [sellerId, listings] of Object.entries(bySeller)) {
      if (summary.attached >= limit) break
      const login = await post('/auth/login', {
        loginName: logins.get(sellerId), password
      })
      const session = jsonResponse(login, 200)
      assert.equal(session.account.id, sellerId, 'Seller login resolved to the wrong account')
      const headers = {
        origin, cookie: login.headers['set-cookie'].split(';')[0],
        'x-csrf-token': login.json().csrfToken
      }
      try {
        for (const item of listings) {
          if (summary.attached >= limit) break
          const detail = jsonResponse(await post(`/listings/${item.id}/detail`, {}), 200)
          if (detail.publicationStatus !== 'published' || detail.seller.id !== item.seller.id ||
            detail.media.length !== 0) continue
          if (detail.saleMode === 'one_off' &&
            await db.client.order.count({ where: { listingId: item.id } })) continue
          const bytes = [0, 1].map((position) => files.get(`${item.category}:${position}`))
          assert.ok(bytes.every(Boolean), `Missing image for ${item.category}`)
          const mediaIds = []
          for (const image of bytes) mediaIds.push(await upload(headers, image))
          const description = `${detail.description}\n\n示意图说明：图片仅展示商品类别，并非该商品实物或交付内容。`
          const edited = jsonResponse(await post(`/listings/${item.id}/edit`, {
            version: detail.version, mediaIds, description
          }, headers), 200)
          assert.deepEqual(edited.media.map((image) => image.id), mediaIds)
          for (const [index, image] of edited.media.entries()) {
            const read = await app.inject({ method: 'GET', url: image.url })
            assert.equal(read.statusCode, 200, `Media read failed: ${item.id}`)
            assert.equal(createHash('sha256').update(read.rawPayload).digest('hex'),
              createHash('sha256').update(bytes[index]).digest('hex'))
          }
          summary.attached++
          console.log(`attached ${summary.attached}/${summary.eligible}: ${item.id}`)
        }
      } finally {
        await post('/auth/logout', {}, headers).catch(() => {})
      }
    }
  }
  console.log(JSON.stringify({ final: true, ...summary }))
} finally {
  await app.close()
  await db.onModuleDestroy()
}
