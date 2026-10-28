import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'
import { validateImageBytes } from '../dist/media/media-policy.js'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const verifyOnly = args.has('--verify')
const limitArg = [...args].find((arg) => arg.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity
assert.ok(!(apply && verifyOnly) &&
  (limit === Infinity || (Number.isInteger(limit) && limit > 0)))
assert.ok([...args].every((arg) => ['--apply', '--verify'].includes(arg) ||
  /^--limit=[1-9]\d*$/.test(arg)))

const root = resolve(import.meta.dirname, '../..')
const review = resolve(root, 'images/catalog-review')
const secretPath = (name) => resolve(root, `infra/.secrets/garage-app/${name}`)
const env = {
  ...process.env,
  GARAGE_HOT_ENDPOINT: process.env.GARAGE_HOT_ENDPOINT ?? 'http://127.0.0.1:3900',
  GARAGE_HOT_PUBLIC_ENDPOINT: process.env.GARAGE_HOT_PUBLIC_ENDPOINT ?? 'http://localhost:3900',
  GARAGE_COLD_ENDPOINT: process.env.GARAGE_COLD_ENDPOINT ?? 'http://127.0.0.1:3903',
  GARAGE_HOT_ACCESS_KEY_ID_FILE: process.env.GARAGE_HOT_ACCESS_KEY_ID_FILE ?? secretPath('hot_access_key_id'),
  GARAGE_HOT_SECRET_KEY_FILE: process.env.GARAGE_HOT_SECRET_KEY_FILE ?? secretPath('hot_secret_key'),
  GARAGE_COLD_ACCESS_KEY_ID_FILE: process.env.GARAGE_COLD_ACCESS_KEY_ID_FILE ?? secretPath('cold_access_key_id'),
  GARAGE_COLD_SECRET_KEY_FILE: process.env.GARAGE_COLD_SECRET_KEY_FILE ?? secretPath('cold_secret_key')
}
const config = readConfig(env)
const dbUrl = new URL(config.databaseUrl)
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname))
assert.equal(dbUrl.pathname, '/bazaar_dev')
assert.equal(dbUrl.searchParams.get('schema'), 'bazaar')
assert.equal(decodeURIComponent(dbUrl.username), 'bazaar_runtime')
for (const endpoint of [config.mediaStore?.hotEndpoint, config.mediaStore?.hotPublicEndpoint,
  config.mediaStore?.coldEndpoint]) {
  assert.ok(endpoint)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname))
}

const plan = JSON.parse(await readFile(resolve(review, 'catalog-plan.json'), 'utf8'))
const sources = JSON.parse(await readFile(resolve(review, 'sources.json'), 'utf8'))
const editable = new Map(plan.filter((row) => !row.locked).map((row) => [row.id, row]))
assert.equal(plan.filter((row) => row.locked).length, 75)
assert.equal(editable.size, 225)
assert.equal(sources.length, editable.size)
const files = new Map()
for (const source of sources) {
  const target = editable.get(source.id)
  assert.ok(target, `Unplanned or locked image: ${source.id}`)
  assert.ok(!files.has(source.id), `Duplicate listing image: ${source.id}`)
  assert.equal(source.publicationStatus, target.publicationStatus)
  assert.ok(['image/jpeg', 'image/png', 'image/webp'].includes(source.mime))
  assert.ok(/^assets\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(source.file))
  const bytes = await readFile(resolve(review, source.file))
  assert.equal(bytes.length, source.byteSize)
  assert.ok(validateImageBytes(bytes, source.mime), `Invalid image: ${source.id}`)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256)
  files.set(source.id, { source, bytes })
}

const app = await createApp(config, false)
const db = app.get(DatabaseService).client
const store = new GarageObjectStore(config.mediaStore)
const report = { mode: apply ? 'apply' : verifyOnly ? 'verify' : 'preview', targets: 225,
  lockedExcluded: 75, lockedVerified: 0, alreadyCorrect: 0, pending: 0,
  changed: 0, verified: 0, orderSnapshotRefs: null }

function responseJson(response, expected) {
  if (response.statusCode !== expected)
    throw new Error(`API HTTP ${response.statusCode}: ${response.json().code ?? 'unexpected'}`)
  return response.json()
}

async function post(path, payload, headers = { origin: config.appOrigin }) {
  return app.inject({ method: 'POST', url: `/api${path}`, headers, payload })
}

async function login(name, password) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await post('/auth/login', { loginName: name, password })
    if (response.statusCode === 429 && response.json().code === 'RATE_LIMITED' && attempt === 0) {
      console.log('Login rate limit reached; waiting for its 60-second window')
      await new Promise((done) => setTimeout(done, 61000))
      continue
    }
    const view = responseJson(response, 200)
    return { headers: { origin: config.appOrigin,
      cookie: response.headers['set-cookie'].split(';')[0],
      'x-csrf-token': view.csrfToken }, accountId: view.account.id }
  }
  throw new Error('Seller login failed')
}

async function verifyImage(listingId, mediaId, source, published) {
  const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })
  assert.equal(asset.status, 'ready')
  assert.equal(asset.sha256, source.sha256)
  assert.equal(asset.contentType, source.mime)
  let bytes
  if (published) {
    const response = await app.inject({ method: 'GET',
      url: `/api/listings/${listingId}/media/${mediaId}` })
    assert.equal(response.statusCode, 200, `Published image unreadable: ${listingId}`)
    bytes = response.rawPayload
  } else {
    assert.ok(asset.hotKey)
    bytes = (await store.readHot(asset.hotKey, 5 * 1024 * 1024 + 1)).bytes
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256)
  report.verified++
}

try {
  const lockedPlan = plan.filter((row) => row.locked)
  const lockedRows = await db.listing.findMany({
    where: { id: { in: lockedPlan.map((row) => row.id) } },
    include: { _count: { select: { orderListingRows: true } } }
  })
  assert.equal(lockedRows.length, lockedPlan.length, 'A locked listing is missing')
  const lockedById = new Map(lockedRows.map((row) => [row.id, row]))
  for (const target of lockedPlan) {
    const row = lockedById.get(target.id)
    assert.equal(row.saleMode, 'one_off')
    assert.ok(row._count.orderListingRows > 0)
    assert.equal(row.title, target.before.title, `Locked title changed: ${target.id}`)
    assert.equal(row.description, target.before.description, `Locked description changed: ${target.id}`)
    assert.equal(row.priceAmount.toString(), target.before.priceAmount)
    assert.equal(row.currency, target.before.currency)
    assert.equal(row.version, target.before.version, `Locked version changed: ${target.id}`)
    report.lockedVerified++
  }
  const rows = await db.listing.findMany({
    where: { id: { in: sources.map((source) => source.id) } },
    include: { listingSeller: { select: { id: true, loginName: true } },
      mediaRows: { orderBy: { position: 'asc' }, include: { media: true } },
      _count: { select: { orderListingRows: true } } }
  })
  assert.equal(rows.length, sources.length, 'A reviewed listing is missing')
  const byId = new Map(rows.map((row) => [row.id, row]))
  const pending = []
  for (const source of sources) {
    const row = byId.get(source.id)
    const target = editable.get(source.id)
    assert.equal(row.title, target.product.title, `Title drift: ${source.id}`)
    assert.equal(row.publicationStatus, target.publicationStatus, `Status drift: ${source.id}`)
    assert.ok(row.description.includes('展示用测试商品；'), `Non-test listing: ${source.id}`)
    assert.ok(/^v2\.stress(?:\.r2)?\.seller\.[1-6]@gmail\.com$/.test(row.listingSeller.loginName),
      `Non-test seller: ${source.id}`)
    assert.ok(row.saleMode !== 'one_off' || row._count.orderListingRows === 0,
      `Ordered one-off listing: ${source.id}`)
    if (row.mediaRows.length === 1 && row.mediaRows[0].media.sha256 === source.sha256) {
      report.alreadyCorrect++
      if (verifyOnly) await verifyImage(source.id, row.mediaRows[0].mediaId,
        source, row.publicationStatus === 'published')
    } else pending.push({ row, ...files.get(source.id) })
  }
  report.pending = pending.length
  if (verifyOnly) {
    assert.equal(pending.length, 0, 'Some covers are missing or mismatched')
    const snapshots = await db.orderMediaSnapshot.findMany({
      select: { storageTier: true, media: { select: {
        status: true, hotKey: true, coldKey: true
      } } }
    })
    for (const snapshot of snapshots) {
      assert.equal(snapshot.media.status, 'ready')
      assert.ok(snapshot.storageTier === 'cold' ? snapshot.media.coldKey : snapshot.media.hotKey,
        'Order snapshot lost its storage reference')
    }
    report.orderSnapshotRefs = snapshots.length
  }
  console.log(JSON.stringify(report))
  if (apply && pending.length) {
    const folder = resolve(root, 'backend/.tmp')
    await mkdir(folder, { recursive: true, mode: 0o700 })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = resolve(folder, `catalog-review-media-${stamp}.json`)
    const progress = resolve(folder, `catalog-review-media-${stamp}.jsonl`)
    await writeFile(backup, JSON.stringify(pending.map(({ row, source }) => ({
      listingId: row.id, sourceSha256: source.sha256, previousVersion: row.version,
      previousMediaIds: row.mediaRows.map((media) => media.mediaId)
    }))), { mode: 0o600 })
    console.log(`Backup: ${backup}`)
    const bySeller = Map.groupBy(pending, ({ row }) => row.sellerId)
    const password = process.env.V2_SEED_PASSWORD ?? 'V2-Local-Test-Password-2026'
    let processed = 0
    for (const [sellerId, items] of bySeller) {
      if (processed >= limit) break
      const auth = await login(items[0].row.listingSeller.loginName, password)
      assert.equal(auth.accountId, sellerId, 'Wrong seller session')
      try {
        for (const { row, source, bytes } of items) {
          if (processed >= limit) break
          const current = await db.listing.findUniqueOrThrow({
            where: { id: row.id }, include: { _count: { select: { orderListingRows: true } },
              mediaRows: { orderBy: { position: 'asc' }, include: { media: true } } }
          })
          assert.equal(current.sellerId, sellerId)
          assert.equal(current.version, row.version, `Concurrent edit: ${row.id}`)
          assert.equal(current.publicationStatus, row.publicationStatus)
          assert.ok(current.saleMode !== 'one_off' || current._count.orderListingRows === 0)
          if (current.mediaRows.length === 1 && current.mediaRows[0].media.sha256 === source.sha256)
            continue
          const reusable = await db.mediaAsset.findMany({ where: {
            sellerId, status: 'ready', sha256: source.sha256,
            listingRows: { none: {} }, orderRows: { none: {} }
          }, take: 2 })
          let mediaId
          if (reusable.length === 1) mediaId = reusable[0].id
          else {
            const intent = responseJson(await post('/media/upload-intents', {
              contentType: source.mime, byteSize: bytes.length
            }, auth.headers), 201)
            const upload = await fetch(intent.uploadUrl, { method: 'PUT',
              headers: { 'Content-Type': source.mime }, body: bytes })
            assert.ok(upload.ok, `Garage upload failed: HTTP ${upload.status}`)
            const completed = responseJson(await post(`/media/${intent.assetId}/complete`, {}, auth.headers), 200)
            assert.equal(completed.status, 'ready')
            assert.equal(completed.sha256, source.sha256)
            mediaId = completed.assetId
          }
          const updated = responseJson(await post(`/listings/${row.id}/edit`, {
            version: current.version, mediaIds: [mediaId]
          }, auth.headers), 200)
          assert.deepEqual(updated.media.map((media) => media.id), [mediaId])
          await verifyImage(row.id, mediaId, source, row.publicationStatus === 'published')
          await appendFile(progress, JSON.stringify({ listingId: row.id, oldMediaIds:
            current.mediaRows.map((media) => media.mediaId), mediaId, sha256: source.sha256 }) + '\n')
          report.changed++
          processed++
          console.log(`Updated ${report.changed}: ${row.id}`)
        }
      } finally {
        await post('/auth/logout', {}, auth.headers).catch(() => {})
      }
    }
  }
  console.log(JSON.stringify({ final: true, ...report }))
} finally {
  await app.close()
}
