import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import ts from 'typescript'
import { sandbox, connect } from '../tests/helpers/database.mjs'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { grantRuntime } from './runtime-grants.mjs'
import { grantObserver } from './observer-grants.mjs'
import { alphaE2EAccounts, seedAlphaE2E } from './alpha-e2e-seed.mjs'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'

const base = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
base.password = (
  await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')
).trim()
const port = Number(process.env.ALPHA_E2E_PORT ?? process.env.I5_BROWSER_PORT ?? 3939)
const origin = `http://127.0.0.1:${port}`
const resultsDirectory = resolve(
  process.env.E2E_RESULTS_DIR ?? new URL('../../frontend/e2e-results', import.meta.url).pathname
)
await rm(resultsDirectory, { recursive: true, force: true })
await mkdir(resultsDirectory, { recursive: true })

let db
let admin
const suffix = randomUUID().replaceAll('-', '')
const runtimeRole = `ae_runtime_${suffix}`
const observerRole = `ae_observer_${suffix}`
const observeSchema = `ae_observe_${suffix}`
const requestLogs = []
const garageSecret = async (name) => (await readFile(new URL(
  `../../infra/.secrets/garage-app/${name}`, import.meta.url), 'utf8')).trim()
const hotCredentials = {
  accessKeyId: await garageSecret('hot_access_key_id'),
  secretAccessKey: await garageSecret('hot_secret_key')
}
const mediaStore = new GarageObjectStore({
  hotEndpoint: 'http://127.0.0.1:3900', hotPublicEndpoint: 'http://localhost:3900',
  coldEndpoint: 'http://127.0.0.1:3903', hotCredentials,
  coldCredentials: {
    accessKeyId: await garageSecret('cold_access_key_id'),
    secretAccessKey: await garageSecret('cold_secret_key')
  },
  hotBucket: 'bazaar-hot', coldBucket: 'bazaar-cold'
})
const corsClient = new S3Client({ endpoint: 'http://127.0.0.1:3900', region: 'garage',
  forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', credentials: hotCredentials })
let originalCors
let app
let frontend
let browser
let observer
let sellerContext
let buyerContext
let stage = 'setup'
let runtimeRoleCreated = false
let observerRoleCreated = false
let observeSchemaCreated = false
let slowReadRequestCount

const waitForText = (page, text) =>
  page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 })

async function login(page, loginName, password) {
  await page.goto(`${origin}/zh-CN/login`)
  await page.getByLabel('登录名').fill(loginName)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  await page.getByRole('button', { name: /退出登录/ }).waitFor({ state: 'visible' })
}

async function publish(page, values) {
  await page.goto(`${origin}/zh-CN/listings/create`)
  if (values.type === 'digital')
    await page.getByRole('tab', { name: '数字资产' }).click()
  await page.getByLabel('商品分类').selectOption(values.category)
  await page.getByLabel('标题').fill(values.title)
  await page.getByLabel(/详细描述/).fill(values.description)
  await page.getByPlaceholder('0.00').fill(values.price)
  await page.getByLabel('商品图片（1–8 张，每张不超过 5 MiB）').setInputFiles({
    name: 'alpha.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2joAAAAASUVORK5CYII=', 'base64')
  })
  if (values.type === 'digital') {
    await page.getByLabel('授权说明').fill(values.licenseDescription)
    await page.getByLabel('内容版本').fill(values.contentVersion)
  }
  await page.getByRole('button', { name: '立即发布' }).click()
  await waitForText(page, '商品发布成功')
  await page.waitForURL(/\/zh-CN\/listing\/[0-9a-f-]+$/)
  await page.getByTestId('acceptance-listing-status').getByText('在售').waitFor()
  return new URL(page.url()).pathname.split('/').at(-1)
}

async function observerRows(sql) {
  return observer.client.$queryRawUnsafe(sql)
}

try {
  originalCors = (await corsClient.send(new GetBucketCorsCommand({
    Bucket: 'bazaar-hot'
  }))).CORSRules
  if (!originalCors?.length) throw new Error('Garage hot CORS is unavailable')
  await corsClient.send(new PutBucketCorsCommand({ Bucket: 'bazaar-hot',
    CORSConfiguration: { CORSRules: originalCors.map((rule) => ({
      ...rule, AllowedOrigins: [...new Set([...(rule.AllowedOrigins ?? []), origin])]
    })) }
  }))
  db = await sandbox(base)
  admin = await connect(base)
  const password = `Alpha-E2E-${randomUUID()}`
  const seeded = await seedAlphaE2E(db.client, password)
  assert.equal(seeded.categories.includes('digital_assets'), true)
  assert.equal(await db.client.rateSnapshot.count(), 1)

  const runtimePassword = randomUUID()
  const observerPassword = randomUUID()
  await admin.client.$executeRawUnsafe(
    `CREATE ROLE "${runtimeRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`
  )
  runtimeRoleCreated = true
  await admin.client.$executeRawUnsafe(
    `CREATE ROLE "${observerRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${observerPassword}'`
  )
  observerRoleCreated = true
  await admin.client.$executeRawUnsafe(
    `ALTER ROLE "${observerRole}" SET default_transaction_read_only = on`
  )
  await admin.client.$executeRawUnsafe(`ALTER ROLE "${observerRole}" SET statement_timeout = '5s'`)
  await admin.client.$executeRawUnsafe(
    `ALTER ROLE "${observerRole}" SET search_path = "${observeSchema}", pg_catalog`
  )
  await db.client.$executeRawUnsafe(`CREATE SCHEMA "${observeSchema}"`)
  observeSchemaCreated = true
  await grantRuntime(db.client, db.schema, runtimeRole)
  await grantObserver(db.client, db.schema, observeSchema, observerRole)

  const observerUrl = new URL(db.url)
  observerUrl.username = observerRole
  observerUrl.password = observerPassword
  observerUrl.searchParams.set('schema', observeSchema)
  observer = await connect(observerUrl)
  const runtimeUrl = new URL(db.url)
  runtimeUrl.username = runtimeRole
  runtimeUrl.password = runtimePassword
  app = await createApp(
    readConfig({ DATABASE_URL: runtimeUrl.toString(), APP_ORIGIN: origin }),
    false,
    { logRequest: (entry) => requestLogs.push(entry), mediaStore }
  )
  await app.listen(0, '127.0.0.1')
  const backendPort = app.getHttpServer().address().port
  frontend = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: new URL('../../frontend/', import.meta.url),
      env: { ...process.env, BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    }
  )
  let frontendOutput = ''
  for (const stream of [frontend.stdout, frontend.stderr])
    stream.on('data', (chunk) => {
      frontendOutput = `${frontendOutput}${chunk}`.slice(-8000)
    })
  const deadline = Date.now() + 60000
  let ready = false
  while (Date.now() < deadline) {
    try {
      ready = (await fetch(`${origin}/zh-CN`, { signal: AbortSignal.timeout(1500) })).ok
      if (ready) break
    } catch {
      // Next.js may still be compiling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  assert.equal(ready, true, `Frontend did not start:\n${frontendOutput}`)

  browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
  sellerContext = await browser.newContext({
    recordVideo: { dir: resolve(resultsDirectory, 'video-seller') }
  })
  buyerContext = await browser.newContext({
    recordVideo: { dir: resolve(resultsDirectory, 'video-buyer') }
  })
  await sellerContext.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await buyerContext.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const sellerPage = await sellerContext.newPage()
  const buyerPage = await buyerContext.newPage()

  stage = 'seller login and UI publication'
  await login(sellerPage, alphaE2EAccounts.seller, password)
  const physicalListingId = await publish(sellerPage, {
    type: 'physical',
    category: 'electronics',
    title: 'Alpha E2E Inventory Item',
    description: 'Physical inventory fixture published through the real Next.js form.',
    price: '25.00'
  })
  const digitalListingId = await publish(sellerPage, {
    type: 'digital',
    category: 'digital_assets',
    title: 'Alpha E2E Digital Delivery',
    description: 'Digital product published through the real Next.js seller workflow.',
    price: '12.50',
    licenseDescription: 'Single buyer license; private payload follows after payment.',
    contentVersion: '2026.09-e2e'
  })
  await sellerPage.screenshot({
    path: resolve(resultsDirectory, 'seller-published.png'),
    fullPage: true
  })

  stage = 'home catalog sections show both listing types from the API'
  await sellerPage.goto(`${origin}/zh-CN`)
  await sellerPage.getByRole('heading', { name: '💎 数字资产' }).locator('..')
    .getByText('Alpha E2E Digital Delivery').waitFor({ state: 'visible' })
  await sellerPage.getByRole('heading', { name: '📦 实物二手' }).locator('..')
    .getByText('Alpha E2E Inventory Item').waitFor({ state: 'visible' })

  stage = 'favorites page and navigation agree on persisted public listings'
  await sellerPage.goto(`${origin}/zh-CN/listing/${digitalListingId}`)
  await sellerPage.getByRole('button', { name: '收藏', exact: true }).click()
  await sellerPage.getByLabel('1 收藏', { exact: true }).waitFor({ state: 'visible' })
  await sellerPage.evaluate(() => {
    const key = 'c2c:user:favorites'
    const ids = JSON.parse(globalThis.localStorage.getItem(key) ?? '[]')
    globalThis.localStorage.setItem(key, JSON.stringify([...ids, globalThis.crypto.randomUUID()]))
  })
  await sellerPage.goto(`${origin}/zh-CN/favorites`)
  await sellerPage.getByRole('heading', { name: '我的收藏 (1)', exact: true }).waitFor({ state: 'visible' })
  await sellerPage.getByLabel('1 收藏', { exact: true }).waitFor({ state: 'visible' })
  assert.equal(await sellerPage.locator(`a[href="/zh-CN/listing/${digitalListingId}"]`).count(), 1)
  await sellerPage.screenshot({ path: resolve(resultsDirectory, 'seller-favorites.png'), fullPage: true })

  stage = 'explore reads persisted listings with both price sort directions'
  await sellerPage.goto(`${origin}/zh-CN/explore`)
  const searchResponse = sort => sellerPage.waitForResponse(response => {
    if (!response.url().endsWith('/api/listings/search')) return false
    const input = response.request().postDataJSON()
    return input?.keyword === 'Alpha E2E' && input.sort === sort
  })
  const newestResponse = searchResponse('newest')
  await sellerPage.getByLabel('关键词').fill('Alpha E2E')
  assert.equal((await newestResponse).status(), 200)
  for (const [sort, ids] of [
    ['price_asc', [digitalListingId, physicalListingId]],
    ['price_desc', [physicalListingId, digitalListingId]]
  ]) {
    const response = searchResponse(sort)
    await sellerPage.getByTestId('sort-trigger').click()
    await sellerPage.getByTestId(`sort-option-${sort}`).click()
    const result = await response
    assert.equal(result.status(), 200)
    const data = await result.json()
    assert.equal(data.total, 2)
    assert.deepEqual(data.items.map(item => item.id), ids)
    await sellerPage.locator(`a[href="/zh-CN/listing/${ids[0]}"]`).waitFor({ state: 'visible' })
    await sellerPage.waitForFunction(expected => {
      const actual = Array.from(globalThis.document.querySelectorAll('a[href^="/zh-CN/listing/"]'))
        .map(link => new URL(link.href).pathname.split('/').at(-1))
      return JSON.stringify(actual) === JSON.stringify(expected)
    }, ids)
    const visibleIds = await sellerPage.locator('a[href^="/zh-CN/listing/"]').evaluateAll(links =>
      links.map(link => new URL(link.href).pathname.split('/').at(-1)))
    assert.deepEqual(visibleIds, ids)
    assert.equal(await sellerPage.getByRole('alert').count(), 0)
  }

  stage = 'buyer login and physical inventory reservation'
  await login(buyerPage, alphaE2EAccounts.buyer, password)
  const beforeInventory = await observerRows(
    `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE availability = 'available')::int AS available_count
      FROM physical_inventory WHERE listing_id = '${physicalListingId}'::uuid`
  )
  assert.deepEqual(beforeInventory, [{ total: 1, available_count: 1 }])
  await buyerPage.goto(`${origin}/zh-CN/listing/${physicalListingId}`)
  await buyerPage.getByRole('button', { name: '立即购买' }).click()
  await buyerPage.getByLabel('收件人').fill('Alpha Buyer')
  await buyerPage.getByLabel('联系方式').fill('e2e-contact')
  await buyerPage.getByLabel('收货地址').fill('E2E isolated test address')
  await buyerPage.getByRole('button', { name: '确认下单' }).click()
  await buyerPage.waitForURL(/\/zh-CN\/me$/)
  const reservedInventory = await observerRows(
    `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE availability = 'available')::int AS available_count,
      count(*) FILTER (WHERE availability = 'reserved')::int AS reserved_count,
      bool_or(active_order_id IS NOT NULL) AS has_order
      FROM physical_inventory WHERE listing_id = '${physicalListingId}'::uuid`
  )
  assert.deepEqual(reservedInventory, [
    { total: 1, available_count: 0, reserved_count: 1, has_order: true }
  ])

  stage = 'buyer digital checkout and payment'
  await buyerPage.goto(`${origin}/zh-CN/listing/${digitalListingId}`)
  await buyerPage.getByRole('button', { name: '立即购买' }).click()
  assert.equal(await buyerPage.getByLabel('收件人').count(), 0)
  await buyerPage.getByRole('button', { name: '确认下单' }).click()
  await buyerPage.waitForURL(/\/zh-CN\/me$/)
  await buyerPage.getByRole('button', { name: '查看详情' }).first().click()
  await buyerPage.waitForURL(/\/me\/orders\/[0-9a-f-]+$/)
  const digitalOrderUrl = buyerPage.url()
  const digitalOrderId = new URL(digitalOrderUrl).pathname.split('/').at(-1)
  await buyerPage.getByRole('button', { name: '确认付款' }).click()
  await buyerPage.getByTestId('acceptance-order-status').getByText('待交付').waitFor()

  stage = 'slow real order read does not overlap periodic or focus refresh'
  const refreshSource = await readFile(new URL('../../frontend/src/lib/refresh-policy.ts', import.meta.url), 'utf8')
  const refreshModule = ts.transpileModule(refreshSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const { orderRefreshIntervalMs } = await import(`data:text/javascript,${encodeURIComponent(refreshModule)}`)
  const detailPattern = `**/api/orders/${digitalOrderId}`
  let releaseRead
  const heldRead = new Promise(resolveRead => { releaseRead = resolveRead })
  slowReadRequestCount = 0
  const holdDetail = async route => {
    slowReadRequestCount++
    const response = await route.fetch()
    if (slowReadRequestCount === 1) await heldRead
    await route.fulfill({ response })
  }
  await buyerPage.route(detailPattern, holdDetail)
  try {
    const readStarted = buyerPage.waitForRequest(request => request.url().endsWith(`/api/orders/${digitalOrderId}`))
    await buyerPage.reload()
    await readStarted
    await buyerPage.evaluate(() => {
      for (let index = 0; index < 5; index++) globalThis.window.dispatchEvent(new globalThis.Event('focus'))
    })
    // Hold the actual database response beyond one configured polling interval.
    await new Promise(resolveWait => setTimeout(resolveWait, orderRefreshIntervalMs + 1000))
    assert.equal(slowReadRequestCount, 1, 'Slow order reads must not overlap or restart')
    releaseRead()
    await buyerPage.getByTestId('acceptance-order-status').getByText('待交付').waitFor()
  } finally {
    releaseRead()
    await buyerPage.unroute(detailPattern, holdDetail)
  }

  stage = 'seller private delivery and buyer reveal'
  await sellerPage.goto(digitalOrderUrl)
  await sellerPage.getByLabel('交付链接').fill('https://example.com/alpha-e2e-private')
  await sellerPage.getByLabel('提取码').fill('ALPHA-PRIVATE-2026')
  await sellerPage.getByRole('button', { name: '提交交付' }).click()
  await buyerPage.getByTestId('acceptance-order-status').getByText('待验收').waitFor({
    timeout: 20000
  })
  const privateLink = buyerPage.getByRole('link', { name: '打开交付链接' })
  await privateLink.waitFor({ state: 'visible' })
  assert.equal(await privateLink.getAttribute('href'), 'https://example.com/alpha-e2e-private')
  await waitForText(buyerPage, '提取码：ALPHA-PRIVATE-2026')
  await buyerPage.screenshot({
    path: resolve(resultsDirectory, 'buyer-private-delivery.png'),
    fullPage: true
  })

  stage = 'after-sales issue and refund'
  await buyerPage.getByLabel('问题描述').fill('Private payload did not match the promised version.')
  await buyerPage.getByRole('button', { name: '报告问题' }).click()
  await buyerPage.getByTestId('acceptance-order-status').getByText('争议处理中').waitFor()
  await buyerPage.getByRole('button', { name: '申请退款' }).click()
  await waitForText(sellerPage, 'Private payload did not match the promised version.')
  await sellerPage.getByRole('button', { name: '退款' }).click()
  await sellerPage.getByTestId('acceptance-order-status').getByText('已退款').waitFor()
  await buyerPage.getByTestId('acceptance-order-status').getByText('已退款').waitFor({
    timeout: 20000
  })
  await buyerPage.screenshot({
    path: resolve(resultsDirectory, 'buyer-refunded.png'),
    fullPage: true
  })
  await sellerPage.screenshot({
    path: resolve(resultsDirectory, 'seller-refunded.png'),
    fullPage: true
  })

  stage = 'observer facts and request correlation'
  const orders = await observerRows(
    `SELECT status FROM orders WHERE id = '${digitalOrderId}'::uuid`
  )
  assert.deepEqual(orders, [{ status: 'refunded' }])
  const deliveries = await observerRows(
    `SELECT kind, sequence FROM deliveries WHERE order_id = '${digitalOrderId}'::uuid`
  )
  assert.deepEqual(deliveries, [{ kind: 'digital', sequence: 1 }])
  const events = await observerRows(
    `SELECT operation, request_id FROM order_events WHERE order_id = '${digitalOrderId}'::uuid ORDER BY created_at, id`
  )
  assert.deepEqual(
    events.map((event) => event.operation),
    ['create', 'pay', 'deliver', 'issue', 'request_refund', 'refund']
  )
  for (const event of events) {
    assert.match(event.request_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)
    assert.ok(
      requestLogs.some(
        (entry) => entry.requestId === event.request_id && entry.route.includes('/api/orders')
      ),
      `No HTTP trace matched ${event.operation} request ${event.request_id}`
    )
  }
  await writeFile(
    resolve(resultsDirectory, 'acceptance-summary.json'),
    `${JSON.stringify(
      {
        result: 'passed',
        accounts: Object.values(alphaE2EAccounts),
        physicalListingId,
        digitalListingId,
        digitalOrderId,
        slowReadRequestCount,
        finalStatus: orders[0].status,
        inventory: reservedInventory[0],
        correlatedRequestIds: events.map((event) => event.request_id)
      },
      null,
      2
    )}\n`
  )
  console.log(`PASS: full-stack Alpha journey; artifacts: ${resultsDirectory}`)
} catch (error) {
  console.error(`Alpha E2E failed at ${stage}`)
  console.error(error)
  process.exitCode = 1
} finally {
  await Promise.allSettled([
    sellerContext?.tracing.stop({ path: resolve(resultsDirectory, 'seller-trace.zip') }),
    buyerContext?.tracing.stop({ path: resolve(resultsDirectory, 'buyer-trace.zip') })
  ])
  await Promise.allSettled([sellerContext?.close(), buyerContext?.close()])
  await browser?.close()
  if (frontend?.pid && frontend.exitCode === null) {
    try {
      process.kill(-frontend.pid, 'SIGTERM')
    } catch {
      // Process may already be gone.
    }
  }
  await app?.close()
  await observer?.onModuleDestroy()
  if (db) {
    const assets = await db.client.mediaAsset.findMany({ select: { hotKey: true, uploadKey: true } })
    for (const key of new Set(assets.flatMap((asset) => [asset.hotKey, asset.uploadKey]).filter(Boolean)))
      await mediaStore.deleteHot(key)
  }
  if (observeSchemaCreated && admin)
    await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${observeSchema}" CASCADE`)
  await db?.close()
  if (observerRoleCreated && admin)
    await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${observerRole}"`)
  if (runtimeRoleCreated && admin)
    await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`)
  await admin?.onModuleDestroy()
  if (originalCors)
    await corsClient.send(new PutBucketCorsCommand({
      Bucket: 'bazaar-hot', CORSConfiguration: { CORSRules: originalCors }
    }))
  corsClient.destroy()
}
