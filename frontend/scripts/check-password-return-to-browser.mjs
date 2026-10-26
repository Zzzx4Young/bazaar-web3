import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const frontendDirectory = resolve(import.meta.dirname, '..')
const server = createServer()
await new Promise((done, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', done)
})
const port = server.address().port
await new Promise(done => server.close(done))
const origin = `http://127.0.0.1:${port}`
let frontend, browser

try {
  frontend = spawn(process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'],
    { cwd: frontendDirectory, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [frontend.stdout, frontend.stderr])
    stream.on('data', chunk => { output = (output + chunk).slice(-3000) })
  const deadline = Date.now() + 90_000
  let ready = false
  while (Date.now() < deadline && frontend.exitCode === null) {
    try {
      const response = await fetch(`${origin}/zh-CN/login`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) { ready = true; break }
    } catch { /* Next.js is still compiling. */ }
    await new Promise(done => setTimeout(done, 300))
  }
  assert.ok(ready, `Frontend did not become ready: ${output}`)

  browser = await chromium.launch({ headless: true })
  const cases = [
    ['/en/explore?sort=recent#results', '/zh-CN/explore?sort=recent#results'],
    ['/enterprise', '/zh-CN/enterprise'],
    ['/en//example.com', '/zh-CN'],
    ['//example.com', '/zh-CN'],
    ['/en/%2F%2Fexample.com', '/zh-CN'],
    ['/en/\\example.com', '/zh-CN']
  ]
  for (const [returnTo, expected] of cases) {
    const page = await browser.newPage()
    await page.route('**/api/auth/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/auth/methods'))
        return route.fulfill({ json: { password: true, google: false, emailCode: false } })
      if (path.endsWith('/auth/login'))
        return route.fulfill({ json: { account: { id: 'buyer', loginName: 'buyer',
          displayName: 'Buyer', role: 'participant' }, csrfToken: 'browser-test' } })
      return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } })
    })
    await page.goto(`${origin}/zh-CN/login?returnTo=${encodeURIComponent(returnTo)}`)
    await page.locator('section').getByLabel('登录名').fill('buyer')
    await page.locator('section').getByLabel('密码').fill('test-password')
    await page.locator('section').getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForURL(url => `${url.pathname}${url.search}${url.hash}` === expected,
      { timeout: 15_000 })
    assert.equal(new URL(page.url()).origin, origin)
    await page.close()
  }
  const emailCases = [
    ['/zh-CN/explore?category=art&page=2#results', '/zh-CN/explore?category=art&page=2#results'],
    ['/zh-CN/login?returnTo=%2Fexplore%3Fsort%3Dprice%23results',
      '/zh-CN/explore?sort=price#results'],
    ['/zh-CN/login?returnTo=%2Fen%2F%2Fevil.com', '/zh-CN/me']
  ]
  for (const [source, expected] of emailCases) {
    const page = await browser.newPage()
    await page.route('**/api/auth/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/auth/methods'))
        return route.fulfill({ json: { password: true, google: false, emailCode: true } })
      if (path.endsWith('/auth/email/request'))
        return route.fulfill({ status: 202, json: { accepted: true } })
      if (path.endsWith('/auth/email/verify'))
        return route.fulfill({ json: { account: { id: 'buyer', loginName: 'buyer@gmail.com',
          displayName: 'Buyer', role: 'participant' }, csrfToken: 'browser-test' } })
      return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } })
    })
    await page.goto(`${origin}${source}`)
    await page.locator('header').getByRole('button', { name: '登录' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '邮箱验证码登录' }).click()
    await dialog.getByLabel('Gmail 邮箱').fill('buyer@gmail.com')
    await dialog.getByRole('button', { name: '获取验证码' }).click()
    await dialog.getByLabel('6 位验证码').fill('123456')
    await dialog.getByRole('button', { name: '验证并继续' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForURL(url => `${url.pathname}${url.search}${url.hash}` === expected,
      { timeout: 15_000 })
    assert.equal(new URL(page.url()).origin, origin)
    await page.close()
  }
  console.log(JSON.stringify({ passwordRedirectCases: cases.length,
    navEmailRedirectCases: emailCases.length, sameOrigin: true }))
} finally {
  await browser?.close()
  if (frontend && frontend.exitCode === null) {
    const exited = once(frontend, 'exit')
    frontend.kill('SIGTERM')
    await exited
  }
}
