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

// Real API and isolated test schema. No credentials enter browser build parameters or artifacts.
const url = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
url.password = (
  await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')
).trim()
const port = Number(process.env.SESSION_CHECK_PORT ?? 3838)
const origin = `http://127.0.0.1:${port}`
const db = await sandbox(url)
const admin = await connect(url)
const role = `browser_${randomUUID().replaceAll('-', '')}`
let roleCreated = false
let app, server, browser
let stage = 'database setup'
const sensitive = [url.toString(), url.password, decodeURIComponent(url.password)]
try {
  const password = randomUUID()
  sensitive.push(password)
  await provisionAccounts(db.client, [
    { loginName: 'session-check', displayName: 'Session Check', password }
  ])
  const secret = randomUUID()
  sensitive.push(secret)
  await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${secret}'`)
  roleCreated = true
  await grantRuntime(db.client, db.schema, role)
  const runtime = new URL(db.url)
  runtime.username = role
  runtime.password = secret
  sensitive.push(runtime.toString())
  app = await createApp(readConfig({ DATABASE_URL: runtime.toString(), APP_ORIGIN: origin }), false)
  stage = 'backend listen'
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: new URL('../../frontend/', import.meta.url),
      env: { ...process.env, BACKEND_ORIGIN: `http://127.0.0.1:${address.port}` },
      stdio: 'ignore',
      detached: true
    }
  )
  let startupError = false
  server.on('error', () => {
    startupError = true
  })
  const deadline = Date.now() + 60000
  stage = 'frontend startup'
  while (true) {
    if (startupError || server.exitCode !== null) throw new Error('Frontend process failed')
    try {
      if ((await fetch(`${origin}/zh-CN`, { signal: AbortSignal.timeout(2000) })).ok) break
    } catch {}
    if (Date.now() > deadline) throw new Error('Frontend startup timeout')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  stage = 'browser launch'
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const { expect } = await import('../../frontend/node_modules/@playwright/test/index.mjs')
  await page.goto(`${origin}/zh-CN`)
  stage = 'login'
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByLabel('登录名').fill('session-check')
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  await expect(page.getByRole('button', { name: 'Session Check · 退出登录' })).toBeVisible()
  stage = 'backend restart'
  await app.close()
  app = await createApp(readConfig({ DATABASE_URL: runtime.toString(), APP_ORIGIN: origin }), false)
  await app.listen(address.port, '127.0.0.1')
  await page.reload()
  stage = 'reload'
  await expect(page.getByRole('button', { name: 'Session Check · 退出登录' })).toBeVisible()
  stage = 'independent session'
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await otherPage.goto(`${origin}/zh-CN`)
  await expect(otherPage.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await other.close()
  await page.route('**/api/auth/logout', (route) => route.abort())
  stage = 'failed logout'
  await page.getByRole('button', { name: 'Session Check · 退出登录' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '账户请求失败' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Session Check · 退出登录' })).toBeEnabled()
  await page.unroute('**/api/auth/logout')
  const rejected = await context.request.post(`${origin}/api/auth/session`, {
    headers: { Origin: 'https://outsider.invalid' },
    data: {}
  })
  stage = 'origin rejection'
  assert.equal(rejected.status(), 403)
  await page.getByRole('button', { name: 'Session Check · 退出登录' }).click()
  stage = 'logout retry'
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  assert.equal(await db.client.session.count({ where: { revokedAt: null } }), 0)
  console.log(
    'PASS: same-origin login, backend restart, independent session, reload, failed logout, retry, revocation and Origin rejection'
  )
} catch (error) {
  console.error(
    `Frontend session check failed at ${stage}; credentials and browser artifacts suppressed`
  )
  let message = error instanceof Error ? error.message : 'Unknown error'
  for (const value of sensitive) message = message.replaceAll(value, '[REDACTED]')
  console.error(message.slice(0, 1500))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server?.pid && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve))
    process.kill(-server.pid, 'SIGTERM')
    await stopped
  }
  await app?.close()
  await db.close()
  if (roleCreated) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
  await admin.onModuleDestroy()
}
