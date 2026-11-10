import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

// API responses are deliberate substitutes. --local-chain replaces wallet RPC
// and transaction execution only; it does not claim API/DB/finality integration.
const native = process.argv.includes('--local-chain')
const frontendDirectory = resolve(import.meta.dirname, '..')
const listener = createServer()
await new Promise((done) => listener.listen(0, '127.0.0.1', done))
const port = listener.address().port
await new Promise((done) => listener.close(done))
const origin = `http://127.0.0.1:${port}`
const artifact = process.env.T09_BROWSER_EVIDENCE_DIR
const oid = '11111111-1111-4111-8111-111111111111'
const version = '22222222-2222-4222-8222-222222222222'
const a = '0x' + '11'.repeat(20),
  b = '0x' + '22'.repeat(20),
  h = '0x' + '33'.repeat(32)
let chain, frontend, browser, walletClient
let output = ''
const result = {
  api: 'substitute',
  wallet: native ? 'real local Anvil transactions via test signing bridge' : 'EIP-1193 substitute',
  sepolia: false,
  independentProviders: false,
  checks: []
}
try {
  if (native) {
    const { localEscrow } = await import('../../backend/tests/helpers/local-escrow.mjs')
    chain = await localEscrow()
    const viem = await import('../../backend/node_modules/viem/_esm/index.js')
    walletClient = viem.createWalletClient({
      account: chain.buyer,
      transport: viem.http(chain.rpc)
    })
  }
  const permit = native
    ? await chain.paymentPermit()
    : {
        schemaVersion: 1,
        intentId: h,
        orderId: h,
        stockId: h,
        stockGeneration: '0',
        previousOrderId: '0x' + '00'.repeat(32),
        chainId: 11155111,
        buyer: a,
        seller: b,
        refundAddress: a,
        token: b,
        escrow: b,
        amountAtoms: '1000001',
        commitmentHash: h,
        issuedAt: 1,
        payDeadline: 2000000000,
        signerKeyId: h
      }
  if (native) await chain.mintTransfer(chain.buyer.address, BigInt(permit.amountAtoms))
  const signature = native ? await chain.paymentSigner.sign(permit) : '0x' + '11'.repeat(65)
  let state = 'Funded',
    refund = false,
    downloadFails = true,
    currentWallet = permit.buyer,
    sends = 0
  // The first phase starts unpaid. API metadata deliberately remains independent
  // from a transaction hint, so the browser cannot manufacture confirmation.
  let intentStatus = 'issued'
  const view = {
    orderId: oid,
    intentId: version,
    permit,
    signature,
    status: intentStatus,
    protection: 'held'
  }
  await writeFile(
    resolve(frontendDirectory, 'tsconfig.t09.json'),
    JSON.stringify({
      extends: './tsconfig.json',
      include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', '.next-t09/types/**/*.ts'],
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
        NEXT_DIST_DIR: '.next-t09',
        NEXT_TS_CONFIG: 'tsconfig.t09.json',
        NEXT_TELEMETRY_DISABLED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  for (const s of [frontend.stdout, frontend.stderr])
    s.on('data', (x) => {
      output = (output + x).slice(-6000)
    })
  let ready = false
  for (let i = 0; i < 240 && frontend.exitCode === null; i++) {
    try {
      if ((await fetch(origin + '/zh-CN/login', { signal: AbortSignal.timeout(1500) })).ok) {
        ready = true
        break
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 250))
  }
  assert.ok(ready, 'Frontend not ready: ' + output)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.exposeFunction('testWalletRequest', async ({ method, params }) => {
    if (method === 'eth_chainId') return '0x' + permit.chainId.toString(16)
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [currentWallet]
    if (method === 'eth_getCode')
      return native
        ? ((await chain.publicClient.getCode({ address: currentWallet })) ?? '0x')
        : '0x'
    if (method === 'eth_sendTransaction') {
      sends++
      if (!native) return h
      const tx = params[0]
      assert.equal(tx.from.toLowerCase(), chain.buyer.address.toLowerCase())
      const hash = await walletClient.sendTransaction({
        chain: null,
        to: tx.to,
        data: tx.data,
        value: 0n
      })
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash })
      assert.equal(receipt.status, 'success')
      return hash
    }
    throw new Error('Unexpected wallet method ' + method)
  })
  await page.addInitScript(() => {
    window.ethereum = {
      request: (args) => window.testWalletRequest(args),
      on() {},
      removeListener() {}
    }
  })
  const auth = {
    account: {
      id: 'buyer',
      loginName: 'buyer@gmail.com',
      displayName: 'Buyer',
      role: 'participant'
    },
    csrfToken: 't09-test-only'
  }
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (value, status = 200) => route.fulfill({ status, json: value })
    if (path.endsWith('/auth/session')) return json(auth)
    if (path.endsWith('/auth/methods'))
      return json({ password: true, google: false, emailCode: true })
    if (path === `/api/orders/${oid}`)
      return json({
        id: oid,
        buyerId: 'buyer',
        sellerId: 'seller',
        settlementMode: 'testnet_escrow',
        status: 'pending_payment',
        type: 'digital',
        title: 'Test digital file',
        price: { amount: '1', currency: 'USD' },
        version: 1
      })
    if (path.endsWith('/terms')) return json({ payment: permit, intentId: version })
    if (path.endsWith('/payment-intents/' + version + '/read'))
      return json({ ...view, status: intentStatus })
    if (path.endsWith('/transaction-attempts')) return json({ id: version, status: 'submitted' })
    if (path.endsWith('/transaction-attempts/' + version + '/refresh'))
      return json({ status: 'finalized', observation: { businessConfirmation: false } })
    if (path.endsWith('/reconcile')) return json({ status: intentStatus })
    if (path.endsWith('/delivery/read')) {
      if (downloadFails) return json({ code: 'FILE_UNAVAILABLE' }, 503)
      return json({
        orderId: oid,
        chainId: permit.chainId,
        escrow: permit.escrow,
        chainOrderId: permit.orderId,
        state: refund ? 'Refunded' : state,
        firstVersionId: version,
        publishedVersionIds: [],
        protectedMapping: false,
        downloadsAvailable: !refund,
        deliveryDeadline: 2000000000,
        acceptanceDeadline: 2000604800,
        disputeDeadline: null,
        refundAddress: permit.refundAddress,
        sellerAddress: permit.seller,
        finalizedHeight: '100',
        finalizedBlockHash: h
      })
    }
    if (path.endsWith('/evidence/read')) return json({ evidence: [] })
    if (path.endsWith('/delivery/download'))
      return json({
        url: origin + '/private-test-file',
        expiresAt: new Date(Date.now() + 300000).toISOString()
      })
    if (path.endsWith('/evidence')) return json({ id: version })
    return json({ items: [], total: 0, limit: 20, page: 1, hasMore: false })
  })
  await page.goto(origin + '/zh-CN/me/orders/' + oid)
  await page.getByRole('heading', { name: '测试网订单托管' }).waitFor()
  // Download failure must not remove the independent dispute action/package.
  assert.equal(
    await page.getByRole('button', { name: '发起链上争议', exact: true }).isEnabled(),
    true
  )
  assert.equal(await page.getByRole('button', { name: '保存独立操作包' }).isEnabled(), true)
  result.checks.push('download failure retains dispute and operation package')
  const saved=page.waitForEvent('download')
  await page.getByRole('button',{name:'保存独立操作包'}).click()
  const file=await saved
  const direct=JSON.parse(await readFile(await file.path(),'utf8'))
  assert.equal(direct.chainOrderId,permit.orderId)
  assert.equal(direct.buyer,permit.buyer)
  assert.equal(direct.actions.find(a=>a.action==='openDispute').to,permit.escrow)
  assert.equal(direct.verifiedSnapshot,null)
  result.checks.push('independent package actually downloaded while file service unavailable')

  await page.getByRole('button', { name: '1. 按本单金额授权' }).click()
  await page.getByRole('status').filter({ hasText: '授权不代表付款' }).waitFor()
  if (native) {
    assert.equal(
      await chain.read(permit.token, chain.abi.token, 'allowance', [
        chain.buyer.address,
        permit.escrow
      ]),
      BigInt(permit.amountAtoms)
    )
    assert.equal(
      (await chain.read(permit.escrow, chain.abi.escrow, 'orders', [permit.orderId])).state,
      0
    )
  }
  result.checks.push('exact allowance without funding')
  currentWallet = permit.seller
  const before = sends
  await page.getByRole('button', { name: '2. 托管入金' }).click()
  await page.getByRole('alert').filter({ hasText: '订单固定钱包' }).waitFor()
  assert.equal(sends, before)
  result.checks.push('wrong wallet blocks old-order payment')
  currentWallet = permit.buyer
  await page.getByRole('button', { name: '2. 托管入金' }).click()
  await page
    .getByRole('status')
    .filter({ hasText: /^交易已提交，等待上链/ })
    .waitFor()
  if (native)
    assert.equal(
      (await chain.read(permit.escrow, chain.abi.escrow, 'orders', [permit.orderId])).state,
      1
    )
  await page.getByRole('button', { name: '重新核对', exact: true }).first().click()
  await page.getByRole('status').filter({ hasText: '尚未完成双源最终确认' }).waitFor()
  result.checks.push('transaction hint never confirms business payment')
  intentStatus = 'funded'
  downloadFails = false
  state = 'Delivered'
  await page.getByRole('button', { name: '重新核对', exact: true }).last().click()
  await page.getByText('2000604800', { exact: false }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: '发起链上争议', exact: true }).isEnabled(),
    true
  )
  result.checks.push('original deadline retained and exact version download enabled')
  refund = true
  await page.getByRole('button', { name: '重新核对', exact: true }).last().click()
  await page.getByText('退款最终确认后不再签发新下载链接', { exact: false }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: '申请此版本的 5 分钟下载链接' }).isDisabled(),
    true
  )
  result.checks.push('refund blocks new download links')
  await page.setViewportSize({width:390,height:844})
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0,14).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,text:e.textContent?.slice(0,50)})))
  if(overflow.length) console.log(JSON.stringify({mobileOverflow:overflow}))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
  result.checks.push('mobile viewport has no horizontal overflow')

  if (artifact) {
    await mkdir(artifact, { recursive: true })
    await page.screenshot({
      path: resolve(artifact, native ? 'local-chain.png' : 'wallet-substitute.png'),
      fullPage: true
    })
    await writeFile(
      resolve(artifact, native ? 'local-chain.json' : 'wallet-substitute.json'),
      JSON.stringify(result, null, 2)
    )
  }
  console.log(JSON.stringify(result))
} finally {
  await browser?.close()
  if (frontend && frontend.exitCode === null) {
    const done = once(frontend, 'exit')
    frontend.kill('SIGTERM')
    await done
  }
  await chain?.close()
}
