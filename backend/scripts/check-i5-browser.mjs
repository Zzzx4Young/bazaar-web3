import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import { sandbox, connect } from '../tests/helpers/database.mjs'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { grantRuntime } from './runtime-grants.mjs'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'
import { exampleCommitment } from './example-commitment.mjs'

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
  activePage,
  roleCreated = false,
  stage = 'setup'
const requestLogs = []
const mediaKeys = []
let originalCors
const secretFile = async (name) => (await readFile(new URL(`../../infra/.secrets/garage-app/${name}`, import.meta.url), 'utf8')).trim()
const hotEndpoint = process.env.GARAGE_HOT_ENDPOINT ?? 'http://127.0.0.1:3900'
const coldEndpoint = process.env.GARAGE_COLD_ENDPOINT ?? 'http://127.0.0.1:3903'
const hotPublicEndpoint = process.env.GARAGE_HOT_PUBLIC_ENDPOINT ?? 'http://localhost:3900'
const mediaStore = new GarageObjectStore({
  hotEndpoint, hotPublicEndpoint,
  coldEndpoint,
  hotCredentials: { accessKeyId: await secretFile('hot_access_key_id'), secretAccessKey: await secretFile('hot_secret_key') },
  coldCredentials: { accessKeyId: await secretFile('cold_access_key_id'), secretAccessKey: await secretFile('cold_secret_key') },
  hotBucket: 'bazaar-hot', coldBucket: 'bazaar-cold'
})
const corsClient = new S3Client({
  endpoint: hotEndpoint, region: 'garage', forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: await secretFile('hot_access_key_id'),
    secretAccessKey: await secretFile('hot_secret_key')
  }
})
const logRequest = (entry) => {
  requestLogs.push(entry)
  if (entry.status >= 400) console.log(JSON.stringify(entry))
}
async function fillPhysicalCommitment(page) {
  await page.getByLabel('已知瑕疵（无瑕疵请明确填写）').fill('No known defects')
  await page.getByLabel('附带物（逗号分隔）').fill('Item shown')
  await page.getByLabel('功能说明（无异常请明确填写）').fill('Works normally')
}
try {
  const currentCors = await corsClient.send(new GetBucketCorsCommand({ Bucket: 'bazaar-hot' }))
  originalCors = currentCors.CORSRules
  if (!originalCors?.length) throw new Error('Garage hot bucket CORS is not configured')
  await corsClient.send(new PutBucketCorsCommand({
    Bucket: 'bazaar-hot',
    CORSConfiguration: { CORSRules: originalCors.map((rule) => ({
      ...rule, AllowedOrigins: [...new Set([...(rule.AllowedOrigins ?? []), origin])]
    })) }
  }))
  const password = `I5-${randomUUID()}`
  await provisionAccounts(db.client, [
    { loginName: 'i5-seller', displayName: 'I5 Seller', password },
    { loginName: 'i5-seller-two', displayName: 'I5 Seller Two', password },
    { loginName: 'i5-buyer', displayName: 'I5 Buyer', password },
    { loginName: 'i5-outsider', displayName: 'I5 Outsider', password },
    { loginName: 'i5-expiring', displayName: 'I5 Expiring', password }
  ])
  const secret = randomUUID()
  await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${secret}'`)
  roleCreated = true
  await grantRuntime(db.client, db.schema, role)
  const runtime = new URL(db.url)
  runtime.username = role
  runtime.password = secret
  app = await createApp(readConfig({ DATABASE_URL: runtime.toString(), APP_ORIGIN: origin }), false, {
    logRequest, mediaStore
  })
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
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2joAAAAASUVORK5CYII=', 'base64')
    const key = `i5-browser/${randomUUID()}`
    await mediaStore.putHot(key, bytes, 'image/png')
    mediaKeys.push(key)
    const sellerId = (await db.client.account.findUniqueOrThrow({ where: { loginName: 'i5-seller' } })).id
    const asset = await db.client.mediaAsset.create({ data: {
      sellerId, uploadKey: `i5-browser/staging/${randomUUID()}`,
      hotKey: key, status: 'ready', contentType: 'image/png',
      declaredBytes: bytes.length, actualBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), verifiedAt: new Date()
    } })
    const response = await app.inject({
      method: 'POST',
      url: '/api/listings',
      headers: { origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf },
      payload: { ...payload, commitment: exampleCommitment(payload.type), mediaIds: [asset.id] }
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json()
  }
  const physical = await create(seller, {
    type: 'physical',
    saleMode: 'one_off',
    title: 'I5 Physical Browser',
    description: 'Browser acceptance physical listing',
    category: 'electronics',
    price: { amount: '12.50', currency: 'USD' }
  })
  const physicalRefund = await create(seller, {
    type: 'physical',
    saleMode: 'one_off',
    title: 'I5 Physical Refund',
    description: 'Browser acceptance refund listing',
    category: 'electronics',
    price: { amount: '8.25', currency: 'USD' }
  })
  const digital = await create(seller, {
    type: 'digital',
    saleMode: 'repeatable',
    title: 'I5 Digital Browser',
    description: 'Browser acceptance digital listing',
    category: 'digital_assets',
    price: { amount: '2.00', currency: 'USD' },
    licenseDescription: 'Demo license',
    contentVersion: 'v1'
  })
  await app.close()
  app = await createApp(readConfig({ DATABASE_URL: runtime.toString(), APP_ORIGIN: origin }), false, {
    logRequest, mediaStore
  })
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
  stage = 'expired session redirect'
  const expiringContext = await browser.newContext()
  const expiringPage = await expiringContext.newPage()
  await expiringPage.goto(`${origin}/zh-CN/login`)
  await expiringPage.getByLabel('登录名').fill('i5-expiring')
  await expiringPage.getByLabel('密码').fill(password)
  await expiringPage.getByRole('button', { name: '登录', exact: true }).last().click()
  await expiringPage
    .getByRole('button', { name: 'I5 Expiring · 退出登录' })
    .waitFor({ state: 'visible' })
  await db.client.session.updateMany({
    where: { account: { loginName: 'i5-expiring' }, revokedAt: null },
    data: { revokedAt: new Date() }
  })
  await expiringPage.getByRole('link', { name: '我的', exact: true }).click()
  await expiringPage.waitForURL(/\/zh-CN\/login\?returnTo=%2Fzh-CN%2Fme$/)
  await expiringPage.getByRole('heading', { name: '登录' }).waitFor({ state: 'visible' })
  await expiringContext.close()
  const context = await browser.newContext()
  const page = await context.newPage()
  activePage = page
  stage = 'login'
  await page.goto(`${origin}/zh-CN`)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByLabel('登录名').fill('i5-buyer')
  await page.getByLabel('密码').fill(`${password}-wrong`)
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  const requestIdText = page.getByText(/Request ID: [A-Za-z0-9._:-]+/)
  await requestIdText.waitFor({ state: 'visible' })
  const visibleRequestId = (await requestIdText.textContent())?.match(/Request ID: (\S+)/)?.[1]
  assert.ok(visibleRequestId, 'The intentional login error did not expose a request ID')
  assert.ok(
    requestLogs.some(
      (entry) =>
        entry.requestId === visibleRequestId &&
        entry.route === '/api/auth/login' &&
        entry.status === 401
    ),
    `No backend stdout log matched frontend request ID ${visibleRequestId}`
  )
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
  const orderImage = page.locator('img[src*="/api/orders/"]').first()
  await orderImage.waitFor({ state: 'visible' })
  assert.equal(await orderImage.evaluate((image) => image.complete && image.naturalWidth > 0), true,
    'The buyer must see the order snapshot image from Garage')
  stage = 'unknown payment retry'
  await page.route(
    '**/actions/pay',
    async (route) => {
      await route.fetch()
      await route.abort('failed')
    },
    { times: 1 }
  )
  await page.getByRole('button', { name: '确认付款' }).click()
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
  assert.equal(editedPhysical.statusCode, 409, editedPhysical.body)
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
  await sellerPage.getByRole('button', { name: '提交交付' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'pending_acceptance')
  await page.getByRole('button', { name: '确认验收' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'completed')
  assert.equal(await page.locator('img[src*="/api/orders/"]').first().evaluate((image) =>
    image.complete && image.naturalWidth > 0), true)
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
  await page.getByRole('button', { name: '确认付款' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  const digitalOrderUrl = page.url()
  await sellerPage.goto(digitalOrderUrl)
  stage = 'digital delivery'
  await sellerPage.getByLabel('交付链接').fill('https://example.com/i5-delivery')
  await sellerPage.getByLabel('提取码').fill('I5-CODE')
  await sellerPage.getByRole('button', { name: '提交交付' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'pending_acceptance')
  await assertText(page, '提取码：I5-CODE')
  stage = 'digital issue and redelivery'
  await page.getByLabel('问题描述').fill('Browser digital delivery issue')
  await page.getByRole('button', { name: '报告问题' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'issue')
  await sellerPage.reload()
  await sellerPage.getByLabel('交付链接').fill('https://example.com/i5-redelivery')
  await sellerPage.getByLabel('提取码').fill('I5-NEW-CODE')
  await sellerPage.getByRole('button', { name: '提交交付' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'issue')
  await assertText(page, '提取码：I5-NEW-CODE')
  await page.getByRole('button', { name: '确认验收' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'completed')
  stage = 'repeatable listing browser image edit'
  const oldDigitalMedia = await db.client.orderMediaSnapshot.findFirstOrThrow({
    where: { orderId: digitalOrderUrl.split('/').at(-1) }, select: { mediaId: true }
  })
  activePage = sellerPage
  await sellerPage.goto(`${origin}/zh-CN/me`)
  const digitalListingCard = sellerPage.locator('article').filter({ hasText: 'I5 Digital Browser' }).first()
  await digitalListingCard.getByRole('button', { name: '编辑' }).click()
  await sellerPage.getByLabel('商品描述').fill('Edited digital description after the first order.')
  await sellerPage.getByLabel('更换商品图片').setInputFiles({
    name: 'i5-digital-edited.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2joAAAAASUVORK5CYII=', 'base64')
  })
  await sellerPage.getByRole('button', { name: '保存' }).click()
  await digitalListingCard.getByText(/v2/).waitFor({ state: 'visible' })
  const currentDigitalMedia = await db.client.listingMedia.findFirstOrThrow({
    where: { listingId: digital.id }, select: { mediaId: true }
  })
  assert.notEqual(currentDigitalMedia.mediaId, oldDigitalMedia.mediaId)
  activePage = page
  await page.goto(digitalOrderUrl)
  const historicalDigitalImage = page.locator(
    `img[src*="/api/orders/"][src$="/${oldDigitalMedia.mediaId}"]`
  )
  await historicalDigitalImage.waitFor({ state: 'visible' })
  assert.equal(await historicalDigitalImage.evaluate((image) =>
    image.complete && image.naturalWidth > 0), true)
  assert.equal((await db.client.orderSnapshot.findUniqueOrThrow({
    where: { orderId: digitalOrderUrl.split('/').at(-1) }
  })).description, 'Browser acceptance digital listing')
  stage = 'digital repeat sale'
  await page.goto(`${origin}/zh-CN/listing/${digital.id}`)
  await page.getByRole('button', { name: '立即购买' }).click()
  await page.getByRole('button', { name: '确认下单' }).click()
  await page.waitForURL(/\/zh-CN\/me$/)
  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.locator(`img[src*="/api/orders/"][src$="/${currentDigitalMedia.mediaId}"]`)
    .waitFor({ state: 'visible' })
  assert.equal((await db.client.orderSnapshot.findUniqueOrThrow({
    where: { orderId: page.url().split('/').at(-1) }
  })).description, 'Edited digital description after the first order.')
  assert.equal((await db.client.orderMediaSnapshot.findFirstOrThrow({
    where: { orderId: digitalOrderUrl.split('/').at(-1) }, select: { mediaId: true }
  })).mediaId, oldDigitalMedia.mediaId)
  await page.getByRole('button', { name: '确认付款' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  const repeatedDigitalOrderUrl = page.url()
  await sellerPage.goto(repeatedDigitalOrderUrl)
  await sellerPage.getByLabel('交付链接').fill('https://example.com/i5-repeat-delivery')
  await sellerPage.getByRole('button', { name: '提交交付' }).click()
  await sellerPage.waitForTimeout(150)
  await page.reload()
  await assertText(page, 'pending_acceptance')
  await page.getByRole('button', { name: '确认验收' }).click()
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
  await page.getByRole('button', { name: '确认付款' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await page.getByLabel('问题描述').fill('Browser refund issue')
  await page.getByRole('button', { name: '报告问题' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  await page.getByRole('button', { name: '申请退款' }).click()
  await page.waitForTimeout(150)
  await page.reload()
  const refundOrderUrl = page.url()
  await sellerPage.goto(refundOrderUrl)
  stage = 'physical refund'
  await sellerPage.getByLabel('退货结果').click()
  await sellerPage.getByRole('option', { name: '已退回卖家' }).click()
  await sellerPage.getByRole('button', { name: '退款' }).click()
  await sellerPage.waitForTimeout(150)
  await sellerPage.reload()
  await assertText(sellerPage, 'approved · returned')
  await sellerPage.getByRole('button', { name: '恢复可售' }).click()
  await sellerPage.waitForTimeout(150)
  await sellerPage.reload()
  await assertText(sellerPage, 'refunded')
  const restoredListing = await db.client.listing.findUniqueOrThrow({
    where: { id: physicalRefund.id }
  })
  const lockedAfterRefund = await app.inject({
    method: 'POST', url: `/api/listings/${physicalRefund.id}/edit`,
    headers: { origin, cookie: seller.cookie, 'x-csrf-token': seller.csrf },
    payload: { version: restoredListing.version, title: 'Must remain unchanged' }
  })
  assert.equal(lockedAfterRefund.statusCode, 409, lockedAfterRefund.body)
  stage = 'seller browser photo upload'
  await sellerPage.goto(`${origin}/zh-CN/publish`)
  await sellerPage.getByLabel('标题').fill('I5 Uploaded Browser Photo')
  await sellerPage.getByLabel('详细描述').fill('A real PNG uploaded from the seller browser into Garage.')
  await sellerPage.locator('input[name="priceAmount"]').fill('5.00')
  await fillPhysicalCommitment(sellerPage)
  await sellerPage.getByLabel('商品图片（1–8 张，每张不超过 5 MiB）').setInputFiles({
    name: 'i5-upload.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2joAAAAASUVORK5CYII=', 'base64')
  })
  await sellerPage.getByRole('button', { name: '立即发布' }).click()
  await sellerPage.waitForURL(/\/zh-CN\/listing\//)
  const uploadedListingUrl = sellerPage.url()
  const uploadedImage = sellerPage.locator('img[src*="/api/listings/"]').first()
  await uploadedImage.waitFor({ state: 'visible' })
  assert.equal(await uploadedImage.evaluate((image) => image.complete && image.naturalWidth > 0), true)
  stage = 'buyer order from browser-uploaded image'
  await page.goto(uploadedListingUrl)
  await page.getByRole('button', { name: '立即购买' }).click()
  await page.getByLabel('收件人').fill('Photo Buyer')
  await page.getByLabel('联系方式').fill('photo-contact')
  await page.getByLabel('收货地址').fill('Photo address')
  await page.getByRole('button', { name: '确认下单' }).click()
  await page.waitForURL(/\/zh-CN\/me$/)
  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.waitForURL(/\/me\/orders\//)
  const uploadedOrderImage = page.locator('img[src*="/api/orders/"]').first()
  await uploadedOrderImage.waitFor({ state: 'visible' })
  assert.equal(await uploadedOrderImage.evaluate((image) => image.complete && image.naturalWidth > 0), true)
  stage = 'second seller browser photo and explore cover'
  const secondSellerContext = await browser.newContext()
  const secondSellerPage = await secondSellerContext.newPage()
  activePage = secondSellerPage
  await secondSellerPage.goto(`${origin}/zh-CN/login`)
  await secondSellerPage.getByLabel('登录名').fill('i5-seller-two')
  await secondSellerPage.getByLabel('密码').fill(password)
  await secondSellerPage.getByRole('button', { name: '登录', exact: true }).last().click()
  await secondSellerPage.getByRole('button', { name: /退出登录/ }).waitFor({ state: 'visible' })
  await secondSellerPage.goto(`${origin}/zh-CN/publish`)
  await secondSellerPage.getByLabel('标题').fill('I5 Second Seller Photo')
  await secondSellerPage.getByLabel('详细描述').fill('A second seller publishes a real Garage image.')
  await fillPhysicalCommitment(secondSellerPage)
  await secondSellerPage.locator('input[name="priceAmount"]').fill('6.00')
  await secondSellerPage.getByLabel('商品图片（1–8 张，每张不超过 5 MiB）').setInputFiles({
    name: 'i5-second-seller.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2joAAAAASUVORK5CYII=', 'base64')
  })
  await secondSellerPage.getByRole('button', { name: '立即发布' }).click()
  await secondSellerPage.waitForURL(/\/zh-CN\/listing\//)
  const secondListingUrl = secondSellerPage.url()
  const secondListingId = secondListingUrl.split('/').at(-1)
  await secondSellerPage.locator('img[src*="/api/listings/"]').first()
    .waitFor({ state: 'visible' })
  activePage = page
  await page.goto(`${origin}/zh-CN/explore`)
  await page.getByLabel('关键词').fill('I5 Second Seller Photo')
  const secondCard = page.locator(`a[href="/zh-CN/listing/${secondListingId}"]`)
  await secondCard.waitFor({ state: 'visible' })
  const secondCover = secondCard.locator('img[src*="/api/listings/"]').first()
  await secondCover.waitFor({ state: 'visible' })
  assert.equal(await secondCover.evaluate((image) => image.complete && image.naturalWidth > 0), true,
    'Explore must display the second seller image returned by search')
  await secondCard.click()
  await page.getByRole('button', { name: '立即购买' }).click()
  await page.getByLabel('收件人').fill('Second Seller Buyer')
  await page.getByLabel('联系方式').fill('second-contact')
  await page.getByLabel('收货地址').fill('Second seller test address')
  await page.getByRole('button', { name: '确认下单' }).click()
  await page.waitForURL(/\/zh-CN\/me$/)
  const secondOrder = await db.client.order.findFirstOrThrow({
    where: { listingId: secondListingId }, orderBy: { createdAt: 'desc' }
  })
  const secondOrderUrl = `${origin}/zh-CN/me/orders/${secondOrder.id}`
  await page.goto(secondOrderUrl)
  const secondOrderImage = page.locator('img[src*="/api/orders/"]').first()
  await secondOrderImage.waitFor({ state: 'visible' })
  assert.equal(await secondOrderImage.evaluate((image) =>
    image.complete && image.naturalWidth > 0), true)
  await page.getByRole('button', { name: '确认付款' }).click()
  await page.reload()
  await assertText(page, 'pending_delivery')
  stage = 'second seller delivery and completed order history'
  await secondSellerPage.goto(secondOrderUrl)
  await secondSellerPage.getByLabel('物流公司').fill('Second Seller Carrier')
  await secondSellerPage.getByLabel('物流单号').fill('SECOND-TRACK')
  await secondSellerPage.getByRole('button', { name: '提交交付' }).click()
  await page.reload()
  await assertText(page, 'pending_acceptance')
  await page.getByRole('button', { name: '确认验收' }).click()
  await page.reload()
  await assertText(page, 'completed')
  assert.equal(await secondOrderImage.evaluate((image) =>
    image.complete && image.naturalWidth > 0), true)
  await secondSellerContext.close()
  await sellerContext.close()
  console.log(
    'PASS: two sellers uploaded Garage images; explore, repeatable image edits, old/new order snapshots and completed histories work in the browser'
  )
} catch (error) {
  console.error(`I5 browser acceptance failed at ${stage}`)
  console.error(String(error).slice(0, 1200))
  if (activePage && !activePage.isClosed()) {
    console.error(`Current page: ${activePage.url()}`)
    console.error((await activePage.locator('body').innerText().catch(() => '')).slice(0, 1200))
  }
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
  await app?.close().catch((error) => { console.error(`API cleanup: ${error.name}`); process.exitCode = 1 })
  try {
    const assets = await db.client.mediaAsset.findMany({ select: { hotKey: true, uploadKey: true } })
    for (const key of new Set([...mediaKeys, ...assets.flatMap((asset) => [asset.hotKey, asset.uploadKey]).filter(Boolean)]))
      await mediaStore.deleteHot(key)
  } catch (error) {
    console.error(`Garage object cleanup: ${error.name}`)
    process.exitCode = 1
  }
  await db.close().catch((error) => { console.error(`DB cleanup: ${error.name}`); process.exitCode = 1 })
  if (originalCors) {
    await corsClient.send(new PutBucketCorsCommand({
      Bucket: 'bazaar-hot', CORSConfiguration: { CORSRules: originalCors }
    })).catch((error) => { console.error(`CORS restore: ${error.name}`); process.exitCode = 1 })
  }
  corsClient.destroy()
  if (roleCreated) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
  await admin.onModuleDestroy()
}

async function assertText(page, value) {
  const translated = {
    pending_payment: '待付款', pending_delivery: '待交付',
    pending_acceptance: '待验收', issue: '争议处理中',
    completed: '已完成', refunded: '已退款',
    'approved · returned': '已批准 · 已退回卖家'
  }
  await page
    .getByText(translated[value] ?? value, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
}
