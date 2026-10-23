import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createApp } from '../../backend/dist/app.js'
import { readConfig } from '../../backend/dist/config.js'
import { codeDigest } from '../../backend/dist/auth/email-code.js'
import { sandbox } from '../../backend/tests/helpers/database.mjs'

const frontendDirectory = resolve(import.meta.dirname, '..')
const backendDirectory = resolve(frontendDirectory, '../backend')
process.chdir(backendDirectory)
const testEmail = `browser-${randomUUID().slice(0, 12)}@gmail.com`
const sent = []

async function freePort() {
  const server = createServer()
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}

let db, app, frontend, browser
try {
  db = await sandbox()
  const frontendPort = await freePort()
  const origin = `http://127.0.0.1:${frontendPort}`
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'isolated-browser-test-key-at-least-32-bytes' })
  app = await createApp(config, false, {
    emailSender: { send: async message => { sent.push(message) } }
  })
  await app.listen(0, '127.0.0.1')
  const backendOrigin = `http://127.0.0.1:${app.getHttpServer().address().port}`
  frontend = spawn(process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '-p', String(frontendPort), '-H', '127.0.0.1'],
    { cwd: frontendDirectory, env: { ...process.env, BACKEND_ORIGIN: backendOrigin,
      NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let startupOutput = ''
  for (const stream of [frontend.stdout, frontend.stderr])
    stream.on('data', chunk => { startupOutput = (startupOutput + chunk).slice(-3000) })
  const deadline = Date.now() + 90_000
  let ready = false
  while (Date.now() < deadline && frontend.exitCode === null) {
    try {
      const response = await fetch(`${origin}/zh-CN/login`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) { ready = true; break }
    } catch { /* Next.js is still compiling. */ }
    await new Promise(done => setTimeout(done, 300))
  }
  assert.ok(ready, `Frontend did not become ready (exit ${frontend.exitCode}): ${startupOutput}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`${origin}/zh-CN/login`)
  await page.getByLabel('Gmail 邮箱').fill(testEmail)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByRole('status').filter({ hasText: '验证码已发送' }).waitFor()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, testEmail)

  const challenge = await db.client.emailCodeChallenge.findFirstOrThrow({
    where: { email: testEmail, purpose: 'login' }
  })
  assert.equal(challenge.codeHash,
    codeDigest(config.emailCodeKey, challenge.id, testEmail, 'login', sent[0].code))
  assert.equal(challenge.attempts, 0)
  assert.equal(challenge.consumedAt, null)
  assert.ok(challenge.expiresAt.getTime() > Date.now())

  await page.getByLabel('6 位验证码').fill(sent[0].code)
  await page.getByRole('button', { name: '验证并继续' }).click()
  await page.waitForURL('**/zh-CN/me', { timeout: 15_000 })
  await page.getByText(`登录名：${testEmail}`).waitFor()
  const account = await db.client.account.findUniqueOrThrow({ where: { loginName: testEmail } })
  const identity = await db.client.accountIdentity.findUniqueOrThrow({
    where: { provider_subject: { provider: 'email', subject: testEmail } }
  })
  assert.equal(identity.accountId, account.id)
  assert.ok((await db.client.emailCodeChallenge.findUniqueOrThrow({
    where: { key: challenge.key }
  })).consumedAt)
  await page.reload()
  await page.getByText(`登录名：${testEmail}`).waitFor()
  console.log(JSON.stringify({ email: testEmail, registered: true,
    challengeStoredAsHmac: true, challengeConsumed: true, sessionRestored: true }))
} finally {
  await browser?.close()
  if (frontend && frontend.exitCode === null) {
    const exited = once(frontend, 'exit')
    frontend.kill('SIGTERM')
    await exited
  }
  await app?.close()
  await db?.close()
}
