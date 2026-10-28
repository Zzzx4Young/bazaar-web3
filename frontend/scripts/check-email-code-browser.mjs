import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { readFile, rm, writeFile } from 'node:fs/promises'
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
const distName = `.next-email-e2e-${randomUUID().slice(0, 8)}`
const tsconfigName = `tsconfig.email-e2e-${randomUUID().slice(0, 8)}.json`

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

let db, app, frontend, browser, tsconfigWritten = false
try {
  db = await sandbox()
  const frontendPort = await freePort()
  const origin = `http://127.0.0.1:${frontendPort}`
  const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin,
    EMAIL_CODE_HMAC_KEY: 'isolated-browser-test-key-at-least-32-bytes' })
  app = await createApp(config, false, {
    emailSender: { provenance: 'dev_inbox',
      send: async message => { sent.push(message) } }
  })
  await app.listen(0, '127.0.0.1')
  const backendOrigin = `http://127.0.0.1:${app.getHttpServer().address().port}`
  const tsconfig = JSON.parse(await readFile(resolve(frontendDirectory, 'tsconfig.json'), 'utf8'))
  tsconfig.include = [...tsconfig.include, `${distName}/types/**/*.ts`]
  await writeFile(resolve(frontendDirectory, tsconfigName),
    `${JSON.stringify(tsconfig, null, 2)}\n`, { flag: 'wx' })
  tsconfigWritten = true
  frontend = spawn(process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '-p', String(frontendPort), '-H', '127.0.0.1'],
    { cwd: frontendDirectory, env: { ...process.env, BACKEND_ORIGIN: backendOrigin,
      NEXT_DIST_DIR: distName, NEXT_TS_CONFIG: tsconfigName,
      NEXT_PUBLIC_EMAIL_CODE_DEV_INBOX: '1',
      NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let startupOutput = ''
  for (const stream of [frontend.stdout, frontend.stderr])
    stream.on('data', chunk => { startupOutput = (startupOutput + chunk).slice(-3000) })
  const deadline = Date.now() + 90_000
  let ready = false
  while (Date.now() < deadline && frontend.exitCode === null) {
    try {
      const response = await fetch(`${origin}/zh-CN/register`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) { ready = true; break }
    } catch { /* Next.js is still compiling. */ }
    await new Promise(done => setTimeout(done, 300))
  }
  assert.ok(ready, `Frontend did not become ready (exit ${frontend.exitCode}): ${startupOutput}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`${origin}/zh-CN/register`)
  await page.getByText('使用 Gmail 验证码注册').waitFor()
  await page.getByLabel('Gmail 邮箱').fill(testEmail)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByRole('status').filter({
    hasText: `--email ${testEmail} --purpose register`
  }).waitFor()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, testEmail)

  const challenge = await db.client.emailCodeChallenge.findFirstOrThrow({
    where: { email: testEmail, purpose: 'register' }
  })
  assert.equal(challenge.codeHash,
    codeDigest(config.emailCodeKey, challenge.id, testEmail, 'register', sent[0].code))
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
  assert.equal(identity.verificationSource, 'dev_inbox')
  assert.ok(identity.verifiedAt)
  assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
    where: { key: testEmail }
  })).accountId, account.id)
  assert.equal(await db.client.accountIdentityEvent.count({
    where: { accountId: account.id, action: 'register' }
  }), 1)
  assert.ok((await db.client.emailCodeChallenge.findUniqueOrThrow({
    where: { key: challenge.key }
  })).consumedAt)
  const firstSession = (await page.context().cookies(origin))
    .find(cookie => cookie.name === 'bazaar_session')?.value
  assert.ok(firstSession)
  assert.equal((await db.client.session.findUniqueOrThrow({
    where: { tokenHash: createHash('sha256').update(firstSession).digest('hex') }
  })).authMethod, 'email_code_dev')
  await page.reload()
  await page.getByText(`登录名：${testEmail}`).waitFor()

  await page.getByRole('button', { name: /退出登录/ }).click()
  await page.getByRole('button', { name: '登录', exact: true }).waitFor()
  await page.goto(`${origin}/zh-CN/login`)
  console.log('Registration complete; checking a separate login challenge')
  await page.getByRole('main').getByRole('button', { name: '邮箱验证码登录' }).click()
  await page.getByText('使用 Gmail 验证码登录').waitFor()
  await page.getByLabel('Gmail 邮箱').fill(testEmail)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await page.getByRole('status').filter({
    hasText: `--email ${testEmail} --purpose login`
  }).waitFor()
  assert.equal(sent.length, 2)
  assert.equal(sent[1].to, testEmail)
  const secondChallenge = await db.client.emailCodeChallenge.findFirstOrThrow({
    where: { email: testEmail, purpose: 'login' }
  })
  assert.notEqual(secondChallenge.key, challenge.key)
  assert.equal(secondChallenge.codeHash,
    codeDigest(config.emailCodeKey, secondChallenge.id, testEmail, 'login', sent[1].code))

  await page.getByLabel('6 位验证码').fill(sent[1].code)
  await page.getByRole('button', { name: '验证并继续' }).click()
  await page.waitForURL('**/zh-CN/me', { timeout: 15_000 })
  await page.getByText(`登录名：${testEmail}`).waitFor()
  const secondSession = (await page.context().cookies(origin))
    .find(cookie => cookie.name === 'bazaar_session')?.value
  assert.ok(secondSession)
  assert.notEqual(secondSession, firstSession)
  assert.equal(await db.client.account.count({ where: { loginName: testEmail } }), 1)
  assert.equal((await db.client.accountIdentity.findUniqueOrThrow({
    where: { provider_subject: { provider: 'email', subject: testEmail } }
  })).accountId, account.id)
  assert.ok((await db.client.emailCodeChallenge.findUniqueOrThrow({
    where: { key: challenge.key }
  })).consumedAt)
  await page.reload()
  await page.getByText(`登录名：${testEmail}`).waitFor()
  console.log(JSON.stringify({ email: testEmail, registered: true, signedOut: true,
    loggedInAgain: true, accountCount: 1, sessionRotated: true,
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
  await rm(resolve(frontendDirectory, distName), { recursive: true, force: true })
  if (tsconfigWritten) await rm(resolve(frontendDirectory, tsconfigName))
}
