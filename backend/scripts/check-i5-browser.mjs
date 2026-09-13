import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import { sandbox, connect } from '../tests/helpers/database.mjs'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { grantRuntime } from './runtime-grants.mjs'

const base = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
base.password = (
  await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')
).trim()
const port = Number(process.env.I5_BROWSER_PORT ?? 3939)
const origin = `http://127.0.0.1:${port}`
const db = await sandbox(base)
const admin = await connect(base)
const role = `i5_${randomUUID().replaceAll('-', '')}`
let app,
  frontend,
  browser,
  roleCreated = false,
  stage = 'setup'
try {
  const password = `I5-${randomUUID()}`
  await provisionAccounts(db.client, [
    { loginName: 'i5-seller', displayName: 'I5 Seller', password },
    { loginName: 'i5-buyer', displayName: 'I5 Buyer', password },
    { loginName: 'i5-outsider', displayName: 'I5 Outsider', password }
  ])
  const secret = randomUUID()
  await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${secret}'`)
  roleCreated = true
  await grantRuntime(db.client, db.schema, role)
  const runtime = new URL(db.url)
  runtime.username = role
  runtime.password = secret
  app = await createApp(readConfig({ DATABASE_URL: runtime.toString(), APP_ORIGIN: origin }), false)
  const login = async (name) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { loginName: name, password }
    })
    assert.equal(response.statusCode, 200, response.body)
    return { cookie: response.headers['set-cookie'].split(';')[0], csrf: response.json().csrfToken }
  }
  const seller = await login('i5-seller')
  await login('i5-buyer')
  const outsider = await login('i5-outsider')
  const create = async (auth, payload) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/listings',
      headers: { origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf },
      payload
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json()
  }
  const physical = await create(seller, {
    type: 'physical',
    title: 'I5 Physical Browser',
    description: 'Browser acceptance physical listing',
    category: 'electronics',
    price: { amount: '12.50', currency: 'USD' }
  })
  const physicalRefund = await create(seller, {
    type: 'physical',
    title: 'I5 Physical Refund',
    description: 'Browser acceptance refund listing',
    category: 'electronics',
    price: { amount: '8.25', currency: 'USD' }
  })
  const digital = await create(seller, {
    type: 'digital',
    title: 'I5 Digital Browser',
    description: 'Browser acceptance digital listing',
    category: 'digital_assets',
    price: { amount: '2.00', currency: 'USD' },
    licenseDescription: 'Demo license',
    contentVersion: 'v1'
  })
  await app.close()
  app = await createApp(readConfig({ DATABASE_URL: runtime.toString(), APP_ORIGIN: origin }), false)
  await app.listen(0, '127.0.0.1')
  const backendPort = app.getHttpServer().address().port
  frontend = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: new URL('../../frontend/', import.meta.url),
      env: { ...process.env, BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}` },
      stdio: 'ignore',
      detached: true
    }
  )
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/zh-CN`, { signal: AbortSignal.timeout(1500) })).ok) break
    } catch {
      /* The frontend may still be compiling. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  stage = 'login'
  await page.goto(`${origin}/zh-CN`)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByLabel('登录名').fill('i5-buyer')
  await page.getByLabel('密码').fill(`${password}-wrong`)
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  await page.getByText(/Request ID: [A-Za-z0-9._:-]+/).waitFor({ state: 'visible' })
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  await page.goto(`${origin}/zh-CN/listing/${physical.id}`)
  stage = 'physical order'
  await page.getByRole('button', { name: '立即购买' }).click()
  await page.getByLabel('收件人').fill('Browser Buyer')
  await page.getByLabel('联系方式').fill('test-contact')
  await page.getByLabel('收货地址').fill('Test address')
  await page.getByRole('button', { name: '确认下单' }).click()
  await page.waitForURL(/\/zh-CN\/me$/)
  await page.getByRole('tab', { name: '我买到的' }).click()
  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.waitForURL(/\/me\/orders\//)
  await assertText(page, 'pending_payment')
  stage = 'unknown payment retry'
  await page.route(
    '**/actions/pay',
    async (route) => {
      await route.fetch()
      await route.abort('failed')
    },
    { times: 1 }
  )
  await page.getByRole('button', { name: 'pay' }).click()
  await assertText(page, '结果未知')
  await page.getByText(/Request ID: [A-Za-z0-9._:-]+/).waitFor({ state: 'visible' })
  await page.reload()
  await page.unroute('**/actions/pay')
  await page.getByRole('button', { name: '重试原操作' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'pending_delivery')
  const physicalOrderUrl = page.url()
  stage = 'physical snapshot'
  const editedPhysical = await app.inject({
    method: 'POST',
    url: `/api/listings/${physical.id}/edit`,
    headers: { origin, cookie: seller.cookie, 'x-csrf-token': seller.csrf },
    payload: { version: physical.version, title: 'I5 Physical Browser Edited' }
  })
  assert.equal(editedPhysical.statusCode, 200, editedPhysical.body)
  await page.reload()
  await assertText(page, 'I5 Physical Browser')
  assert.equal(await page.getByText('I5 Physical Browser Edited', { exact: true }).count(), 0)
  const sellerContext = await browser.newContext()
  const sellerPage = await sellerContext.newPage()
  await sellerPage.goto(`${origin}/zh-CN`)
  await sellerPage.getByRole('button', { name: '登录', exact: true }).click()
  await sellerPage.getByLabel('登录名').fill('i5-seller')
  await sellerPage.getByLabel('密码').fill(password)
  await sellerPage.getByRole('button', { name: '登录', exact: true }).last().click()
  await sellerPage
    .getByRole('button', { name: 'I5 Seller · 退出登录' })
    .waitFor({ state: 'visible' })
  await sellerPage.goto(physicalOrderUrl)
  stage = 'physical delivery'
  await sellerPage.getByLabel('物流公司').fill('I5 Carrier')
  await sellerPage.getByLabel('物流单号').fill('I5-TRACK')
  await sellerPage.getByRole('button', { name: 'deliver' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'pending_acceptance')
  await page.getByRole('button', { name: 'accept' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'completed')
  const physicalOrderId = new URL(physicalOrderUrl).pathname.split('/').at(-1)
  stage = 'buyer isolation'
  const hidden = await context.request.post(`${origin}/api/orders/${physicalOrderId}`, {
    headers: {
      Origin: origin,
      Cookie: outsider.cookie,
      'x-csrf-token': outsider.csrf,
      'content-type': 'application/json'
    },
    data: {}
  })
  assert.equal(hidden.status(), 404)
  await page.goto(`${origin}/zh-CN/listing/${digital.id}`)
  stage = 'digital boundary'
  await page.getByRole('button', { name: '立即购买' }).click()
  assert.equal(await page.getByLabel('收件人').count(), 0)
  await page.getByRole('button', { name: '确认下单' }).click()
  await page.waitForURL(/\/zh-CN\/me$/)
  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.getByRole('button', { name: 'pay' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  const digitalOrderUrl = page.url()
  await sellerPage.goto(digitalOrderUrl)
  stage = 'digital delivery'
  await sellerPage.getByLabel('交付链接').fill('https://example.com/i5-delivery')
  await sellerPage.getByLabel('提取码').fill('I5-CODE')
  await sellerPage.getByRole('button', { name: 'deliver' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'pending_acceptance')
  await assertText(page, '提取码：I5-CODE')
  stage = 'digital issue and redelivery'
  await page.getByLabel('问题描述').fill('Browser digital delivery issue')
  await page.getByRole('button', { name: 'issue' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'issue')
  await sellerPage.reload()
  await sellerPage.getByLabel('交付链接').fill('https://example.com/i5-redelivery')
  await sellerPage.getByLabel('提取码').fill('I5-NEW-CODE')
  await sellerPage.getByRole('button', { name: 'deliver' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'issue')
  await assertText(page, '提取码：I5-NEW-CODE')
  await page.getByRole('button', { name: 'accept' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'completed')
  stage = 'digital repeat sale'
  await page.goto(`${origin}/zh-CN/listing/${digital.id}`)
  await page.getByRole('button', { name: '立即购买' }).click()
  await page.getByRole('button', { name: '确认下单' }).click()
  await page.waitForURL(/\/zh-CN\/me$/)
  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.getByRole('button', { name: 'pay' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  const repeatedDigitalOrderUrl = page.url()
  await sellerPage.goto(repeatedDigitalOrderUrl)
  await sellerPage.getByLabel('交付链接').fill('https://example.com/i5-repeat-delivery')
  await sellerPage.getByRole('button', { name: 'deliver' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'pending_acceptance')
  await page.getByRole('button', { name: 'accept' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'completed')
  await page.goto(`${origin}/zh-CN/listing/${physicalRefund.id}`)
  stage = 'refund checkout'
  await page.getByRole('button', { name: '立即购买' }).click()
  await page.getByLabel('收件人').fill('Refund Buyer')
  await page.getByLabel('联系方式').fill('refund-contact')
  await page.getByLabel('收货地址').fill('Refund address')
  await page.getByRole('button', { name: '确认下单' }).click()
  await page.waitForURL(/\/zh-CN\/me$/)
  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.getByRole('button', { name: 'pay' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await page.getByLabel('问题描述').fill('Browser refund issue')
  await page.getByRole('button', { name: 'issue' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await page.getByRole('button', { name: 'request-refund' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  const refundOrderUrl = page.url()
  await sellerPage.goto(refundOrderUrl)
  stage = 'physical refund'
  await sellerPage.getByLabel('退货结果').click()
  await sellerPage.getByRole('option', { name: '已退回卖家' }).click()
  await sellerPage.getByRole('button', { name: 'refund' }).click()
  await sellerPage.waitForTimeout(150)
  await sellerPage.reload()
  await assertText(sellerPage, 'approved · returned')
  await sellerPage.getByRole('button', { name: 'restore' }).click()
  await sellerPage.waitForTimeout(150)
  await sellerPage.reload()
  await assertText(sellerPage, 'refunded')
  await sellerContext.close()
  console.log(
    'PASS: I5 browser visible request ID, unknown-result replay, private history, outsider denial, physical refund/restore, digital issue/redelivery and repeat sale'
  )
} catch (error) {
  console.error(`I5 browser acceptance failed at ${stage}`)
  console.error(String(error).slice(0, 1200))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (frontend?.pid && frontend.exitCode === null) {
    try {
      process.kill(-frontend.pid, 'SIGTERM')
    } catch {
      /* Process may have already exited. */
    }
  }
  await app?.close()
  await db.close()
  if (roleCreated) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
  await admin.onModuleDestroy()
}

async function assertText(page, value) {
  await page
    .getByText(value, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
}
