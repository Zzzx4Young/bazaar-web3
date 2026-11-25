import { attachRequestLogChannel } from '../../backend/tests/helpers/request-log-channel.mjs'
import { forwardingGate } from './helpers/proxy-forwarding-gate.mjs'
import { checkProxyRetry } from './helpers/web3-proxy-retry.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { createWalletClient, http, encodeFunctionData } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { web3BrowserFixture, unusedPort } from '../../backend/tests/helpers/web3-browser.mjs'

const frontendDirectory = resolve(import.meta.dirname, '..'),
  port = await unusedPort(),
  origin = `http://127.0.0.1:${port}`,
  browserRun = randomUUID(),
  distDirectory = '.next-t09-full-' + browserRun,
  tsConfigName = 'tsconfig.t09-full-' + browserRun + '.json'
const evidence = process.env.T09_FULL_EVIDENCE_DIR
const result = {
  status: 'running',
  startedAt: new Date().toISOString(),
  api: 'real HTTP; no application API interception',
  database: 'isolated PostgreSQL business and security schemas',
  storage: 'real isolated Garage',
  checker: 'real resource-limited Docker checker',
  google: 'provider exchange substitute; real callback/session/purpose/signature flow',
  wallet: 'Node signing bridge to real Anvil, not browser extension',
  independentProviders: false,
  sepolia: false,
  allAcceptanceGroupsPassed: false,
  identity: [],
  orders: [],
  transactions: [],
  cooldowns: [],
  serverRequests: [],
  proxyRequests: [],
  coldStart: { freshNextOutput: distDirectory, newAccountsAndOrders: true },
  requests: []
}
let f, frontend, browser, proxyGate
const diagnosticPages = []
const step = (value) => console.log('T09 full: ' + value)
const hash = (b) => createHash('sha256').update(b).digest('hex')
try {
  if (evidence) {
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
  }
  f = await web3BrowserFixture(origin, { logRequest: (entry) => result.serverRequests.push(entry) })
  result.checkerImage = f.checkerImage
  if (process.env.WEB3_PROXY_RETRY === '1') {
    proxyGate = await forwardingGate(f.backendOrigin)
    result.proxyGate = { origin: proxyGate.origin, backendOrigin: f.backendOrigin, frontendOrigin: origin }
    step('test-only proxy gate on exclusive loopback port ' + new URL(proxyGate.origin).port)
  }
  await writeFile(
    resolve(frontendDirectory, tsConfigName),
    JSON.stringify({
      extends: './tsconfig.json',
      include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', distDirectory + '/types/**/*.ts'],
      exclude: ['node_modules']
    })
  )
  frontend = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: frontendDirectory,
      env: {
        ...process.env,
        BACKEND_ORIGIN: proxyGate?.origin ?? f.backendOrigin,
        NEXT_DIST_DIR: distDirectory,
        NEXT_TS_CONFIG: tsConfigName,
        NEXT_TELEMETRY_DISABLED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  // Proxy JSON is structured and contains no request payload or exception text.
  attachRequestLogChannel(frontend.stdout, false, (entry) => {
    if (entry?.event === 'proxy_request') result.proxyRequests.push(entry)
  }).catch(() => { result.proxyLogChannelFailed = true })
  let output = ''
  for (const s of [frontend.stdout, frontend.stderr])
    s.on('data', (x) => {
      output = (output + x).slice(-5000)
    })
  let ready = false
  for (let i = 0; i < 200 && frontend.exitCode === null; i++) {
    try {
      if ((await fetch(origin + '/zh-CN/login', { signal: AbortSignal.timeout(2000) })).ok) {
        ready = true
        break
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert.ok(ready, 'Next not ready: ' + output)
  browser = await chromium.launch({ headless: true })
  let buyerWallet = f.chain.buyer
  const contexts = []
  async function pageFor(role, getWallet) {
    const context = await browser.newContext({ acceptDownloads: true })
    contexts.push(context)
    await context.route('https://accounts.google.com/o/oauth2/v2/auth**', async (route) => {
      const u = new URL(route.request().url()),
        callback = new URL('/api/auth/wallet/reauth/google/callback', origin)
      callback.searchParams.set('state', u.searchParams.get('state'))
      callback.searchParams.set('code', f.providerCode(f.accounts[role].id))
      await route.fulfill({ status: 302, headers: { location: callback.toString() }, body: '' })
    })
    const page = await context.newPage()
    diagnosticPages.push(page)
    page.on('pageerror', (error) => {
      result.browserErrors ??= []
      result.browserErrors.push(error.message.slice(0, 500))
    })
    const starts = new WeakMap()
    page.on('request', (r) => starts.set(r, new Date().toISOString()))
    page.on('response', (r) => {
      const u = new URL(r.url())
      if (u.origin === origin && u.pathname.startsWith('/api/'))
        result.requests.push({
          role,
          startedAt: starts.get(r.request()) ?? null,
          observedAt: new Date().toISOString(),
          method: r.request().method(),
          path: u.pathname,
          status: r.status(),
          requestId: r.headers()['x-request-id'] ?? null,
          proxyRequestId: r.headers()['x-proxy-request-id'] ?? null,
          applicationRequestId: r.headers()['x-application-request-id'] ?? null,
          statusSource: r.headers()['x-status-source'] ?? null
        })
    })
    await page.exposeFunction('t09Wallet', async ({ method, params }) => {
      const wallet = getWallet()
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet.address]
      if (method === 'eth_chainId') return '0x' + f.chain.config.chainId.toString(16)
      if (method === 'eth_getCode')
        return (await f.chain.publicClient.getCode({ address: params[0] })) ?? '0x'
      if (method === 'eth_getTransactionReceipt')
        return await f.chain.publicClient.request({ method, params })
      if (method === 'personal_sign') return wallet.signMessage({ message: { raw: params[0] } })
      if (method === 'eth_signTypedData_v4') return wallet.signTypedData(JSON.parse(params[1]))
      if (method === 'eth_sendTransaction') {
        const tx = params[0]
        assert.equal(tx.from.toLowerCase(), wallet.address.toLowerCase())
        const current = await f.chain.timestamp()
        await f.chain.publicClient.request({
          method: 'evm_setNextBlockTimestamp',
          params: [Math.max(current, Math.floor(Date.now() / 1000))]
        })
        const client = createWalletClient({ account: wallet, transport: http(f.chain.rpc) })
        const txHash = await client.sendTransaction({
          chain: null,
          to: tx.to,
          data: tx.data,
          value: 0n
        })
        const receipt = await f.chain.publicClient.waitForTransactionReceipt({ hash: txHash })
        assert.equal(receipt.status, 'success')
        result.transactions.push({
          role,
          hash: txHash,
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          to: tx.to
        })
        return txHash
      }
      throw new Error('Unexpected wallet request ' + method)
    })
    await page.addInitScript(() => {
      window.ethereum = { request: (args) => window.t09Wallet(args), on() {}, removeListener() {} }
    })
    return page
  }
  const seller = await pageFor('seller', () => f.chain.seller),
    buyer = await pageFor('buyer', () => buyerWallet)
  async function post(page, path, body = {}, key = randomUUID()) {
    return page.evaluate(
      async ({ path, body, key }) => {
        const a = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          }),
          session = await a.json()
        const r = await fetch('/api/' + path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': session.csrfToken,
            'Idempotency-Key': key
          },
          body: JSON.stringify(body)
        })
        return { status: r.status, data: await r.json() }
      },
      { path, body, key }
    )
  }
  async function login(page, role) {
    await page.goto(origin + '/zh-CN/login')
    const section = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '登录', exact: true }) })
    await section.getByLabel('登录名').fill(f.accounts[role].loginName)
    await section.getByLabel('密码', { exact: true }).fill(f.accounts[role].password)
    await section.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForURL(origin + '/zh-CN')
  }
  async function pace(label) {
    const rows = await f.db.client.authRateBucket.findMany({
      where: { count: { gte: 6 }, windowEnd: { gt: new Date() } },
      select: { windowEnd: true }
    })
    const until = Math.max(0, ...rows.map((x) => x.windowEnd.getTime())) + 200
    if (until > Date.now()) {
      const started = Date.now()
      step('respecting real rate window: ' + label)
      while (Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, until - Date.now())))
      result.cooldowns.push({ label, milliseconds: Date.now() - started })
    }
  }
  async function google(page, role, purpose, wallet, locale = 'zh-CN') {
    await pace(role + ' ' + purpose)
    await page.goto(origin + '/' + locale + '/me')
    await page
      .getByRole('button', { name: locale === 'en' ? 'Connect wallet' : '连接钱包', exact: true })
      .click()
    await page
      .getByLabel(locale === 'en' ? 'Wallet operation' : '钱包操作', { exact: true })
      .selectOption(purpose)
    await page
      .getByRole('button', {
        name:
          locale === 'en' ? 'Reauthenticate independently with Google' : '使用 Google 独立重新认证'
      })
      .click()
    await page.waitForURL(origin + '/' + locale + '/wallet/reauth')
    assert.equal(
      (await page.context().cookies()).some((c) => c.name === 'bazaar_wallet_oauth'),
      false
    )
    if (locale === 'en') {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Sign dedicated authorization and finish' }).waitFor()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true
      )
      if (evidence) {
        await mkdir(evidence, { recursive: true })
        await page.screenshot({
          path: join(evidence, 'google-completion-mobile.png'),
          fullPage: true
        })
      }
      await page.setViewportSize({ width: 1280, height: 900 })
    }
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Sign dedicated authorization and finish' : '签署专用授权并完成操作'
      })
      .click()
    await page.waitForURL(origin + '/' + locale + '/me')
    assert.equal(await page.evaluate(() => sessionStorage.getItem('bazaar:wallet-reauth')), null)
    const binding = await f.db.client.walletIdentity.findUniqueOrThrow({
      where: {
        accountId_chainId: { accountId: f.accounts[role].id, chainId: f.chain.config.chainId }
      }
    })
    assert.equal(binding.address, wallet.address.toLowerCase())
    result.identity.push({
      role,
      purpose,
      address: binding.address,
      bindingVersion: binding.bindingVersion,
      googleProvider: 'substitute',
      locale,
      oauthCookieCleared: true,
      continuationCleared: true
    })
  }
  await login(seller, 'seller')
  await google(seller, 'seller', 'bind', f.chain.seller)
  await google(seller, 'seller', 'payout', f.chain.seller, 'en')
  await login(buyer, 'buyer')
  await google(buyer, 'buyer', 'bind', buyerWallet)
  step('Google independent binding and payout complete')
  await pace('SIWE old session')
  const oldWallet = f.chain.buyer,
    oldPage = await pageFor('buyer', () => oldWallet)
  await oldPage.goto(origin + '/en/login?returnTo=%2Fme')
  await oldPage.getByRole('button', { name: 'Sign in with bound wallet' }).click()
  await oldPage.waitForURL(origin + '/en/me')
  result.identity.push({ siwe: 'current original wallet accepted' })
  buyerWallet = privateKeyToAccount(generatePrivateKey())
  await createWalletClient({
    account: f.chain.deployer,
    transport: http(f.chain.rpc)
  }).sendTransaction({ chain: null, to: buyerWallet.address, value: 1000000000000000000n })
  await google(buyer, 'buyer', 'bind', buyerWallet)
  const oldSession = await oldPage.evaluate(async () => {
    const r = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    return r.status
  })
  assert.equal(oldSession, 401)
  result.identity.push({ oldWalletSession: 'revoked after replacement', status: oldSession })
  await oldPage.context().clearCookies()
  await oldPage.goto(origin + '/en/login')
  await pace('old wallet fresh SIWE rejection')
  await oldPage.getByRole('button', { name: 'Sign in with bound wallet' }).click()
  await oldPage.getByRole('alert').waitFor()
  const oldDenied = await oldPage.evaluate(async (address) => {
    const r = await fetch('/api/auth/wallet/login/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    })
    return { status: r.status, body: await r.json() }
  }, oldWallet.address)
  assert.equal(oldDenied.body.code, 'INVALID_CREDENTIALS')
  assert.ok(new URL(oldPage.url()).pathname.endsWith('/login'))
  result.identity.push({ oldWalletFreshSiwe: 'rejected' })
  await oldPage.close()
  await f.chain.mintTransfer(buyerWallet.address, 4000004n)
  await f.sync()
  for (const listingId of f.listings) {
    const price = await post(seller, `web3/listings/${listingId}/price`, {
      version: 1,
      amount: '1.000001'
    })
    assert.equal(price.status, 200, JSON.stringify(price.data))
    const publicListing = await post(seller, `listings/${listingId}/detail`)
    assert.equal(publicListing.status, 200)
    assert.ok(publicListing.data.testnetPrice)
  }
  const samples = {}
  function zip(label) {
    const path = join(f.root, label + '.zip')
    execFileSync('python3', [
      '-c',
      'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); z.writestr("README.md",sys.argv[2]); z.close()',
      path,
      'Bazaar isolated browser ' + label
    ])
    return path
  }
  async function upload(page, orderId, purpose, label) {
    const group = page.getByRole('group', { name: '上传私有文件' }).first()
    const path = zip(label)
    samples[label] = await readFile(path)
    await group.getByLabel('上传私有文件').setInputFiles(path)
    const [completed] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/complete') && r.request().method() === 'POST'),
      group
        .locator('button')
        .filter({ hasText: /^上传私有文件$/ })
        .click()
    ])
    assert.equal(completed.status(), 200)
    await f.check()
    const [status] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/status') && r.request().method() === 'POST'),
      group.getByRole('button', { name: '检查上传状态' }).click()
    ])
    const checked = await status.json()
    assert.equal(checked.status, 'ready')
    assert.ok(checked.versionId)
    return checked.versionId
  }
  async function failedEvidenceUpload(page, orderId) {
    const group = page.getByRole('group', { name: '上传私有文件' }).first()
    await group.getByLabel('上传私有文件').setInputFiles(zip('failed-evidence-upload'))
    step('R06 evidence upload validation failure begins')
    // Alter only this outgoing attachment declaration. The real API validates
    // the invalid size and generates the error; no response is mocked.
    const match = '**/api/web3/private-files/upload-intents'
    const rejectCapability = (route) => route.continue({
      postData: JSON.stringify({ ...JSON.parse(route.request().postData()), byteSize: 0 })
    })
    await page.route(match, rejectCapability)
    try {
      const [response] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/private-files/upload-intents') && r.request().method() === 'POST', { timeout: 15000 }),
        group.locator('button').filter({ hasText: /^上传私有文件$/ }).click()
      ])
      assert.equal(response.status(), 400)
      const body = await response.json()
      assert.equal(body.code, 'INVALID_INPUT')
      step('R06 actual upload intent rejected with 400')
      await group.getByRole('alert').waitFor({ timeout: 15000 })
      assert.equal(await f.db.client.evidenceRecord.count({ where: { orderId } }), 0)
      const before = await f.orderEvidence(orderId)
      const projection = await f.db.client.escrowProjection.findFirstOrThrow({ where: { businessOrderId: orderId } })
      assert.equal(before.state, 'Delivered')
      result.failedEvidenceUpload = {
        orderId, stateBefore: before.state, fixedBuyer: projection.data.buyer,
        originalDeliveredAt: projection.data.deliveredAt,
        originalAcceptanceDeadline: (BigInt(projection.data.deliveredAt) + 604800n).toString(),
        failure: { method: 'POST', path: new URL(response.url()).pathname,
          observedAt: new Date().toISOString(), status: response.status(), code: body.code,
          requestId: response.headers()['x-request-id'] ?? body.requestId },
        fault: 'attachment byteSize corrupted; actual API validation response, no response interception',
        evidenceRecordsBeforeDispute: 0
      }
    } finally {
      await page.unroute(match, rejectCapability)
    }
  }
  async function refresh(page) {
    await page.getByRole('button', { name: '重新核对', exact: true }).last().click()
  }
  async function buy(index) {
    await pace('purchase ' + index)
    await f.sync()
    await buyer.goto(origin + '/zh-CN/listing/' + f.listings[index])
    let orderId
    if (index === 0 && proxyGate) {
      orderId = await checkProxyRetry({ buyer, fixture: f, gate: proxyGate, evidence, result })
      step('real proxy failure/recovery and PostgreSQL idempotency complete')
    } else {
      await buyer.getByRole('button', { name: '使用 BZTEST 测试托管购买' }).click()
      await buyer.waitForURL(/\/me\/orders\/[0-9a-f-]+$/)
      orderId = new URL(buyer.url()).pathname.split('/').at(-1)
    }
    await Promise.all([
      buyer.waitForResponse(
        (r) => r.url().includes('/payment-intents/') && r.url().endsWith('/read')
      ),
      buyer.getByRole('button', { name: '1. 按本单金额授权' }).click()
    ])
    await buyer.getByRole('status').filter({ hasText: '授权不代表付款' }).waitFor()
    await buyer.getByRole('button', { name: '2. 托管入金' }).click()
    await buyer
      .getByRole('status')
      .filter({ hasText: /^交易已提交，等待上链/ })
      .waitFor()
    const block = await f.sync()
    await refresh(buyer)
    await buyer.getByText('托管状态：已入金', { exact: true }).waitFor()
    await buyer.getByText('已通过双源最终确认。', { exact: true }).waitFor()
    await seller.goto(origin + '/zh-CN/me/orders/' + orderId)
    await seller.getByText('托管状态：已入金', { exact: true }).waitFor()
    step('funded order ' + orderId)
    return { orderId, steps: [{ action: 'funded', block }] }
  }
  const first = await buy(0)
  const firstVersion = await upload(seller, first.orderId, 'delivery', 'delivery-first')
  const [deliveryPermitResponse] = await Promise.all([
    seller.waitForResponse((r) => r.url().endsWith('/delivery/permit')),
    seller.getByRole('button', { name: '申请凭证并登记首次交付' }).click()
  ])
  assert.equal(deliveryPermitResponse.status(), 200, await deliveryPermitResponse.text())
  await seller.getByText('等待双源最终确认；原截止时间继续计时。', { exact: true }).waitFor()
  first.steps.push({ action: 'first-delivery', block: await f.sync(), versionId: firstVersion })
  await refresh(seller)
  const supplement = await upload(seller, first.orderId, 'delivery', 'delivery-supplement')
  await refresh(buyer)
  await buyer.getByText('托管状态：已登记交付', { exact: true }).waitFor()
  const initialRead = await post(buyer, `web3/orders/${first.orderId}/delivery/read`)
  assert.equal(initialRead.data.firstVersionId, firstVersion)
  assert.deepEqual(initialRead.data.publishedVersionIds, [])
  const notPublished = await post(buyer, `web3/orders/${first.orderId}/delivery/download`, {
    versionId: supplement
  })
  assert.equal(notPublished.status, 409)
  async function download(page, versionIndex, label, versionId) {
    await page
      .getByRole('button', { name: '申请此版本的 5 分钟下载链接' })
      .nth(versionIndex)
      .click()
    const link = page.getByRole('link', { name: /申请此版本的 5 分钟下载链接/ })
    await link.waitFor()
    const grantId = new URL(await link.getAttribute('href')).pathname.split('/').at(-1)
    const grant = await f.db.client.downloadGrant.findUniqueOrThrow({ where: { id: grantId } })
    assert.equal(grant.versionId, versionId)
    const [file] = await Promise.all([page.waitForEvent('download'), link.click()])
    const bytes = await readFile(await file.path())
    assert.equal(hash(bytes), hash(samples[label]))
    const actual = await f.db.client.privateFileVersion.findUniqueOrThrow({
      where: { id: versionId }
    })
    assert.equal(actual.sha256, hash(bytes))
    if (evidence) {
      const directory = join(evidence, 'downloads', actual.orderId)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, versionId + '.zip'), bytes)
    }
    return {
      versionId,
      objectVersion: actual.objectVersion,
      sha256: actual.sha256,
      downloadedSha256: hash(bytes),
      grantId,
      basis: grant.basis
    }
  }
  first.downloads = [await download(buyer, 0, 'delivery-first', firstVersion)]
  await Promise.all([
    seller.waitForResponse((r) => r.url().endsWith('/delivery/read') && r.status() === 200),
    seller.getByRole('button', { name: '签署并发布补交版本' }).click()
  ])
  await refresh(buyer)
  await buyer.getByText(supplement, { exact: true }).waitFor()
  const afterSupplement = await post(buyer, `web3/orders/${first.orderId}/delivery/read`)
  assert.equal(afterSupplement.data.firstVersionId, firstVersion)
  assert.equal(afterSupplement.data.acceptanceDeadline, initialRead.data.acceptanceDeadline)
  first.downloads.push(await download(buyer, 1, 'delivery-supplement', supplement))
  await seller.goto(origin + '/zh-CN/me')
  await buyer.getByLabel('主动验收将释放本金；释放后无法再通过托管争议追回。').check()
  await buyer.getByRole('button', { name: '确认验收并结算' }).click()
  await buyer.getByText('等待双源最终确认；原截止时间继续计时。', { exact: true }).waitFor()
  first.steps.push({ action: 'accepted', block: await f.sync() })
  await refresh(buyer)
  await buyer.getByText('托管状态：本金已结算', { exact: true }).waitFor()
  first.final = await f.orderEvidence(first.orderId)
  assert.equal(first.final.state, 'Released')
  result.orders.push(first)
  step('purchase, exact versions, supplement and acceptance complete')
  if (evidence) {
    await mkdir(evidence, { recursive: true })
    await buyer.screenshot({ path: join(evidence, 'accepted.png'), fullPage: true })
  }
  await buyer.goto(origin + '/zh-CN/me')
  await pace('second order')
  const second = await buy(1),
    secondVersion = await upload(seller, second.orderId, 'delivery', 'delivery-refund')
  const [secondPermitResponse] = await Promise.all([
    seller.waitForResponse((r) => r.url().endsWith('/delivery/permit')),
    seller.getByRole('button', { name: '申请凭证并登记首次交付' }).click()
  ])
  assert.equal(secondPermitResponse.status(), 200, await secondPermitResponse.text())
  await seller.getByText('等待双源最终确认；原截止时间继续计时。', { exact: true }).waitFor()
  second.steps.push({ action: 'registered', block: await f.sync(), versionId: secondVersion })
  await seller.goto(origin + '/zh-CN/me')
  await refresh(buyer)
  await buyer.getByText('托管状态：已登记交付', { exact: true }).waitFor()
  second.downloads = [await download(buyer, 0, 'delivery-refund', secondVersion)]
  await failedEvidenceUpload(buyer, second.orderId)
  await buyer.getByRole('button', { name: '发起链上争议', exact: true }).click()
  await buyer.getByText('等待双源最终确认；原截止时间继续计时。', { exact: true }).waitFor()
  second.steps.push({ action: 'disputed', block: await f.sync() })
  await refresh(buyer)
  await buyer.getByText('托管状态：链上争议已生效', { exact: true }).waitFor()
  result.failedEvidenceUpload.stateAfter = (await f.orderEvidence(second.orderId)).state
  assert.equal(result.failedEvidenceUpload.stateAfter, 'Disputed')
  result.failedEvidenceUpload.disputeBlock = second.steps.at(-1).block
  const disputedProjection = await f.db.client.escrowProjection.findFirstOrThrow({ where: { businessOrderId: second.orderId } })
  assert.equal(disputedProjection.data.deliveredAt, result.failedEvidenceUpload.originalDeliveredAt)
  assert.ok(BigInt(disputedProjection.data.disputedAt) < BigInt(result.failedEvidenceUpload.originalAcceptanceDeadline))
  result.failedEvidenceUpload.contractAcceptedAt = disputedProjection.data.disputedAt
  const attachmentVersion = await upload(buyer, second.orderId, 'evidence', 'evidence-attachment')
  await buyer.getByLabel('证据说明').fill('Buyer evidence for ' + second.orderId)
  await buyer.getByLabel('我已了解双方可见及证据保留规则').check()
  const buyerEvidenceSaved = buyer.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/evidence') &&
      r.request().method() === 'POST' &&
      r.status() === 200
  )
  await buyer.getByRole('button', { name: '提交证据', exact: true }).click()
  await buyerEvidenceSaved
  await buyer.getByText('Buyer evidence for ' + second.orderId, { exact: true }).waitFor()
  await seller.goto(origin + '/zh-CN/me/orders/' + second.orderId)
  await seller.getByLabel('证据说明').fill('Seller evidence for ' + second.orderId)
  await seller.getByLabel('我已了解双方可见及证据保留规则').check()
  const sellerEvidenceSaved = seller.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/evidence') &&
      r.request().method() === 'POST' &&
      r.status() === 200
  )
  await seller.getByRole('button', { name: '提交证据', exact: true }).click()
  await sellerEvidenceSaved
  await seller.getByText('Seller evidence for ' + second.orderId, { exact: true }).waitFor()
  const terms = await f.db.client.paymentOrderTerms.findUniqueOrThrow({
    where: { orderId: second.orderId }
  })
  assert.equal(await f.db.client.evidenceRecord.count({ where: { orderId: second.orderId } }), 2)
  if (f.recovery) {
    result.recoveryBackup = await f.recovery.prepare(f.app, [first.orderId, second.orderId])
    step('T10 consistent encrypted pre-refund backup created')
  }
  await f.chain.safeExecute(
    f.chain.deployment.arbitrator,
    f.chain.owners.arbitrator,
    f.chain.config.escrow,
    encodeFunctionData({
      abi: f.chain.abi.escrow,
      functionName: 'resolveDispute',
      args: [terms.terms.orderId, true, '0x' + '00'.repeat(32)]
    })
  )
  second.steps.push({ action: '2-of-3-refund', block: await f.sync() })
  await refresh(buyer)
  await buyer.getByText('托管状态：本金已退款', { exact: true }).waitFor()
  assert.equal(
    await buyer.getByRole('button', { name: '申请此版本的 5 分钟下载链接' }).isDisabled(),
    true
  )
  const rejected = await post(buyer, `web3/orders/${second.orderId}/delivery/download`, {
    versionId: secondVersion
  })
  assert.equal(rejected.status, 409)
  const buyerEvidence = await post(buyer, `web3/orders/${second.orderId}/evidence/read`),
    sellerEvidence = await post(seller, `web3/orders/${second.orderId}/evidence/read`)
  assert.equal(buyerEvidence.status, 200)
  assert.equal(sellerEvidence.status, 200)
  assert.equal(buyerEvidence.data.evidence.length, 2)
  assert.equal(sellerEvidence.data.evidence.length, 2)
  const attachment = buyerEvidence.data.evidence.find((x) => x.versionId === attachmentVersion)
  const evidenceGrant = await post(
    seller,
    `web3/orders/${second.orderId}/evidence/attachments/authorize`,
    { evidenceId: attachment.id }
  )
  assert.equal(evidenceGrant.status, 200)
  const response = await seller.context().request.get(evidenceGrant.data.url)
  assert.equal(response.status(), 200)
  assert.equal(hash(await response.body()), hash(samples['evidence-attachment']))
  second.evidence = {
    bothPartiesReadAfterRefund: true,
    count: 2,
    attachmentVersion,
    attachmentSha256: hash(samples['evidence-attachment']),
    newDeliveryGrantStatus: rejected.status
  }
  second.final = await f.orderEvidence(second.orderId)
  assert.equal(second.final.state, 'Refunded')
  result.orders.push(second)
  result.status = f.recovery ? 'recovery_pending' : 'passed'
  if (evidence) {
    await mkdir(evidence, { recursive: true })
    await buyer.screenshot({ path: join(evidence, 'refund.png'), fullPage: true })
    await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
  }
  step('refund revocation and bilateral evidence complete')
  if (f.recovery) {
    result.recoveryStart = await f.recovery.restore()
    const previousDb = f.db
    f.db = f.recovery.database
    for (const page of [buyer, seller]) {
      const old = await page.evaluate(async () => {
        const r = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        })
        return r.status
      })
      assert.equal(old, 401)
    }
    await login(buyer, 'buyer')
    await login(seller, 'seller')
    const restoredNormal = await post(buyer, `web3/orders/${first.orderId}/delivery/read`)
    assert.equal(restoredNormal.status, 200)
    assert.equal(restoredNormal.data.firstVersionId, firstVersion)
    assert.ok(restoredNormal.data.publishedVersionIds.includes(supplement))
    const normalGrant = await post(buyer, `web3/orders/${first.orderId}/delivery/download`, {
      versionId: firstVersion
    })
    assert.equal(normalGrant.status, 200)
    const normalBytes = await buyer.context().request.get(normalGrant.data.url)
    assert.equal(normalBytes.status(), 200)
    assert.equal(hash(await normalBytes.body()), hash(samples['delivery-first']))
    const refundedGrant = await post(buyer, `web3/orders/${second.orderId}/delivery/download`, {
      versionId: secondVersion
    })
    assert.equal(refundedGrant.status, 409)
    const be = await post(buyer, `web3/orders/${second.orderId}/evidence/read`),
      se = await post(seller, `web3/orders/${second.orderId}/evidence/read`)
    assert.equal(be.status, 200)
    assert.equal(se.status, 200)
    assert.equal(be.data.evidence.length, 2)
    assert.equal(se.data.evidence.length, 2)
    const eg = await post(seller, `web3/orders/${second.orderId}/evidence/attachments/authorize`, {
      evidenceId: attachment.id
    })
    assert.equal(eg.status, 200)
    const eb = await seller.context().request.get(eg.data.url)
    assert.equal(eb.status(), 200)
    assert.equal(hash(await eb.body()), hash(samples['evidence-attachment']))
    if (process.env.T10_CUSTODY === '1') {
      const restoredOldPage = await pageFor('buyer', () => oldWallet)
      await restoredOldPage.goto(origin + '/en/login')
      await pace('restored old wallet SIWE rejection')
      await restoredOldPage.getByRole('button', { name: 'Sign in with bound wallet' }).click()
      await restoredOldPage.getByRole('alert').waitFor()
      const denied = await restoredOldPage.evaluate(async (address) => {
        const r = await fetch('/api/auth/wallet/login/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address })
        })
        return { status: r.status, body: await r.json() }
      }, oldWallet.address)
      assert.equal(denied.body.code, 'INVALID_CREDENTIALS')
      result.restoredOldWallet = { status: denied.status, code: denied.body.code }
      await restoredOldPage.close()
    }
    result.recovery = await f.recovery.complete({
      oldBuyerSession: 401,
      oldSellerSession: 401,
      normalExactVersion: firstVersion,
      normalSha256: hash(await normalBytes.body()),
      refundNewGrant: 409,
      buyerEvidence: 200,
      sellerEvidence: 200,
      evidenceSha256: hash(await eb.body())
    })
    assert.equal(result.recovery.evaluation.status, 'full')
    assert.equal(result.recovery.evaluation.targetsMet, false)
    f.db = previousDb
    if (evidence)
      await writeFile(join(evidence, 'recovery.json'), JSON.stringify(result.recovery, null, 2))
    step('T10 local recovery browser gates complete; independent-provider qualification pending')
  }
  result.status = 'passed'
  if (evidence) await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
  console.log(
    JSON.stringify({
      identityChecks: result.identity.length,
      orders: result.orders.length,
      realTransactions: result.transactions.length,
      api: 'real',
      storage: 'Garage',
      wallet: 'Node bridge',
      sepolia: false
    })
  )
} catch (error) {
  if (result.proxyRetry?.status === 'running') result.proxyRetry.status = 'failed'
  if (evidence) {
    if (result.proxyRetry)
      await writeFile(join(evidence, 'proxy-retry.json'), JSON.stringify(result.proxyRetry, null, 2))
    await mkdir(evidence, { recursive: true })
    await writeFile(
      join(evidence, 'failed-result.json'),
      JSON.stringify(
        {
          ...result,
          status: 'failed',
          error: String(error.message)
            .replace(/Virtual-T09-browser-only-[a-f0-9-]+/g, '[test-secret]')
            .slice(0, 1000)
        },
        null,
        2
      )
    )
    for (let i = 0; i < diagnosticPages.length; i++)
      if (!diagnosticPages[i].isClosed())
        await diagnosticPages[i]
          .screenshot({ path: join(evidence, 'failure-' + i + '.png'), fullPage: true })
          .catch(() => {})
  }
  throw error
} finally {
  await browser?.close()
  if (frontend && frontend.exitCode === null) {
    const done = once(frontend, 'exit')
    frontend.kill('SIGTERM')
    await done
  }
  try {
    await proxyGate?.close()
    await f?.close()
  } finally {
    // These two paths are generated from this process's random browserRun only.
    await rm(resolve(frontendDirectory, distDirectory), { recursive: true, force: true })
    await rm(resolve(frontendDirectory, tsConfigName), { force: true })
  }
}
