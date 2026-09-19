import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import { sandbox, connect } from '../tests/helpers/database.mjs'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { grantRuntime } from './runtime-grants.mjs'
import { grantObserver } from './observer-grants.mjs'
import { buildV2SeedPlan, seedV2 } from './v2-seed.mjs'

const base = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
base.password = (await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')).trim()
const port = Number(process.env.V2_E2E_PORT ?? 3941)
const origin = `http://127.0.0.1:${port}`
const resultsDirectory = resolve(process.env.E2E_RESULTS_DIR ?? new URL('../../frontend/e2e-results-v2', import.meta.url).pathname)
await rm(resultsDirectory, { recursive: true, force: true })
await mkdir(resultsDirectory, { recursive: true })

let db, admin, observer, app, frontend, browser, sellerContext, buyerContext
const suffix = randomUUID().replaceAll('-', '')
const runtimeRole = `v2_runtime_${suffix}`
const observerRole = `v2_observer_${suffix}`
const observeSchema = `v2_observe_${suffix}`
const requestLogs = []
let observeSchemaCreated = false
let runtimeRoleCreated = false
let observerRoleCreated = false
let stage = 'setup'

const waitText = (page, value) => page.getByText(value, { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 })

async function login(page, loginName, password) {
  await page.goto(`${origin}/zh-CN/login`)
  await page.getByLabel('登录名').fill(loginName)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  await page.getByRole('button', { name: /退出登录/ }).waitFor({ state: 'visible' })
}

async function observerRows(sql) {
  return observer.client.$queryRawUnsafe(sql)
}

try {
  db = await sandbox(base)
  admin = await connect(base)
  const password = `V2-E2E-${randomUUID()}`
  const seeded = await seedV2(db.client, { password, seed: 'v2-e2e' })
  assert.equal(seeded.createdListings, 100)
  assert.equal(seeded.createdOrders, 60)
  const plan = buildV2SeedPlan({ seed: 'v2-e2e' })
  const seller = plan.accounts.find((account) => account.key === 'seller5')
  const buyer = plan.accounts.find((account) => account.key === 'buyer5')
  const target = await db.client.order.findFirstOrThrow({
    where: { status: 'pending_acceptance', sellerId: (await db.client.account.findUniqueOrThrow({ where: { loginName: seller.loginName } })).id, buyerId: (await db.client.account.findUniqueOrThrow({ where: { loginName: buyer.loginName } })).id },
    orderBy: { createdAt: 'asc' },
    include: { snapshot: true }
  })
  assert.equal(target.snapshot.type, 'physical')
  assert.ok(Number(target.snapshot.priceAmount) > 0)
  const baselineEvents = await db.client.orderEvent.count({ where: { orderId: target.id } })

  const runtimePassword = randomUUID()
  const observerPassword = randomUUID()
  await admin.client.$executeRawUnsafe(`CREATE ROLE "${runtimeRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`)
  runtimeRoleCreated = true
  await admin.client.$executeRawUnsafe(`CREATE ROLE "${observerRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${observerPassword}'`)
  observerRoleCreated = true
  await admin.client.$executeRawUnsafe(`ALTER ROLE "${observerRole}" SET default_transaction_read_only = on`)
  await admin.client.$executeRawUnsafe(`ALTER ROLE "${observerRole}" SET statement_timeout = '5s'`)
  await admin.client.$executeRawUnsafe(`ALTER ROLE "${observerRole}" SET search_path = "${observeSchema}", pg_catalog`)
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
  app = await createApp(readConfig({ DATABASE_URL: runtimeUrl.toString(), APP_ORIGIN: origin }), false, { logRequest: (entry) => requestLogs.push(entry) })
  await app.listen(0, '127.0.0.1')
  const backendPort = app.getHttpServer().address().port
  frontend = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: new URL('../../frontend/', import.meta.url),
    env: { ...process.env, BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })
  let frontendOutput = ''
  for (const stream of [frontend.stdout, frontend.stderr]) stream.on('data', (chunk) => { frontendOutput = `${frontendOutput}${chunk}`.slice(-8000) })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/zh-CN`, { signal: AbortSignal.timeout(1500) })).ok) break
    } catch {
      // Next.js may still be compiling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  assert.equal((await fetch(`${origin}/zh-CN`)).ok, true, `Frontend did not start:\n${frontendOutput}`)

  browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
  sellerContext = await browser.newContext({ recordVideo: { dir: resolve(resultsDirectory, 'video-seller') } })
  buyerContext = await browser.newContext({ recordVideo: { dir: resolve(resultsDirectory, 'video-buyer') } })
  await sellerContext.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await buyerContext.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const sellerPage = await sellerContext.newPage()
  const buyerPage = await buyerContext.newPage()

  stage = 'desktop and mobile listing search, filters, sort, and pagination'
  await buyerPage.goto(`${origin}/zh-CN/explore`)
  await waitText(buyerPage, '共 70 件商品')
  await buyerPage.getByLabel('关键词').fill('超长中文标题')
  await waitText(buyerPage, '共 1 件商品')
  await buyerPage.screenshot({ path: resolve(resultsDirectory, 'long-title-desktop.png'), fullPage: true })
  await buyerPage.getByRole('button', { name: '重置筛选' }).click()
  await waitText(buyerPage, '共 70 件商品')
  await buyerPage.getByRole('combobox').first().click()
  await buyerPage.getByRole('option', { name: '数字资产' }).click()
  await waitText(buyerPage, '共 14 件商品')
  await buyerPage.getByRole('button', { name: '重置筛选' }).click()
  await waitText(buyerPage, '共 70 件商品')
  await buyerPage.getByTestId('sort-trigger').click()
  await buyerPage.getByTestId('sort-option-price_asc').click()
  await waitText(buyerPage, '第 1 / 7 页')
  await buyerPage.getByRole('button', { name: '下一页' }).click()
  await waitText(buyerPage, '第 2 / 7 页')
  const savedListing = buyerPage.locator('main section a[href*="/listing/"]').first()
  const savedHref = await savedListing.getAttribute('href')
  assert.ok(savedHref)
  await savedListing.click()
  await buyerPage.getByRole('button', { name: '收藏', exact: true }).click()
  await buyerPage.getByLabel('1 收藏').waitFor()
  await buyerPage.goto(`${origin}/zh-CN/favorites`)
  await buyerPage.getByRole('heading', { name: '我的收藏 (1)' }).waitFor()
  await buyerPage.locator(`main a[href="${savedHref}"]`).waitFor()
  await buyerPage.goto(`${origin}${savedHref}`)
  await buyerPage.getByRole('button', { name: '已收藏' }).click()
  await buyerPage.getByLabel('1 收藏').waitFor({ state: 'detached' })
  await buyerPage.goto(`${origin}/zh-CN/favorites`)
  await buyerPage.getByRole('heading', { name: '我的收藏 (0)' }).waitFor()
  await buyerPage.goto(`${origin}/zh-CN/explore`)
  await buyerPage.setViewportSize({ width: 390, height: 844 })
  await buyerPage.screenshot({ path: resolve(resultsDirectory, 'explore-mobile.png'), fullPage: true })

  stage = 'buyer dispute lifecycle'
  await login(buyerPage, buyer.loginName, password)
  await buyerPage.goto(`${origin}/zh-CN/me/orders/${target.id}`)
  await buyerPage.getByTestId('acceptance-order-status').getByText('DELIVERED').waitFor()
  await buyerPage.getByLabel('问题描述').fill('V2 physical delivery dispute with a long multilingual explanation 🧪')
  await buyerPage.getByRole('button', { name: 'issue' }).click()
  await buyerPage.getByTestId('acceptance-order-status').getByText('ISSUE').waitFor()
  await buyerPage.getByRole('button', { name: 'request-refund' }).click()

  stage = 'seller resolution and observer verification'
  await login(sellerPage, seller.loginName, password)
  await sellerPage.goto(`${origin}/zh-CN/me/orders/${target.id}`)
  await waitText(sellerPage, 'V2 physical delivery dispute')
  await sellerPage.getByRole('button', { name: 'refund' }).click()
  await sellerPage.getByTestId('acceptance-order-status').getByText('REFUNDED').waitFor()
  await buyerPage.getByTestId('acceptance-order-status').getByText('REFUNDED').waitFor({ timeout: 15000 })
  await sellerPage.screenshot({ path: resolve(resultsDirectory, 'seller-refunded.png'), fullPage: true })
  await buyerPage.screenshot({ path: resolve(resultsDirectory, 'buyer-refunded.png'), fullPage: true })

  const counts = await observerRows(`SELECT (SELECT count(*)::int FROM listings) AS listings, (SELECT count(*)::int FROM orders) AS orders`)
  assert.deepEqual(counts, [{ listings: 100, orders: 60 }])
  const statusCounts = await observerRows(`SELECT status, count(*)::int AS count FROM orders GROUP BY status ORDER BY status`)
  assert.equal(statusCounts.length, 7)
  const inventory = await observerRows(`SELECT availability, count(*)::int AS count FROM physical_inventory GROUP BY availability ORDER BY availability`)
  assert.ok(inventory.length >= 2)
  const newEvents = await observerRows(`SELECT operation, request_id FROM order_events WHERE order_id = '${target.id}'::uuid ORDER BY created_at, id OFFSET ${baselineEvents}`)
  assert.deepEqual(newEvents.map((event) => event.operation), ['issue', 'request_refund', 'refund'])
  for (const event of newEvents) {
    assert.match(event.request_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/)
    assert.ok(requestLogs.some((entry) => entry.requestId === event.request_id && entry.route.includes('/api/orders')))
  }
  await writeFile(resolve(resultsDirectory, 'acceptance-summary.json'), `${JSON.stringify({ result: 'passed', listings: counts[0].listings, orders: counts[0].orders, statusCounts, inventory, targetOrderId: target.id, newEvents }, null, 2)}\n`)
  console.log(`PASS: V2 business data and edge-case journey; artifacts: ${resultsDirectory}`)
} catch (error) {
  console.error(`V2 E2E failed at ${stage}`)
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
      // The process may already have exited.
    }
  }
  await app?.close()
  await observer?.onModuleDestroy()
  if (observeSchemaCreated && admin) await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${observeSchema}" CASCADE`)
  if (db) await db.close()
  if (observerRoleCreated && admin) await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${observerRole}"`)
  if (runtimeRoleCreated && admin) await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`)
  await admin?.onModuleDestroy()
}
