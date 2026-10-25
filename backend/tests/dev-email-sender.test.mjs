import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDevEmailSender } from '../dist/auth/dev-email-sender.js'
import { readConfig } from '../dist/config.js'

test('development sender accepts only the configured account and keeps the code in a local file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bazaar-dev-email-'))
  try {
    const accountFile = join(dir, 'account')
    const inboxFile = join(dir, 'inbox')
    writeFileSync(accountFile, '  Test.User@Gmail.com  \n')
    writeFileSync(join(dir, 'key'), 'test-only-key-at-least-32-bytes-for-dev-email')
    const env = { NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://test:secret@127.0.0.1:55432/bazaar_test',
      EMAIL_CODE_HMAC_KEY_FILE: join(dir, 'key'),
      EMAIL_CODE_DEV_ACCOUNT_FILE: accountFile, EMAIL_CODE_DEV_INBOX_FILE: inboxFile }
    const sender = createDevEmailSender(env, readConfig(env))
    assert.ok(sender)
    await assert.rejects(sender.send({ to: 'other@gmail.com', code: '111111',
      locale: 'en', purpose: 'login' }))
    await sender.send({ to: 'test.user@gmail.com', code: '123456',
      locale: 'en', purpose: 'login' })
    assert.equal(JSON.parse(readFileSync(inboxFile, 'utf8')).code, '123456')
    assert.equal(readConfig(env).host, '127.0.0.1')
    assert.equal(readConfig(env).appOrigin, 'http://localhost:3000')
    for (const changes of [{ NODE_ENV: 'production' }, { HOST: '0.0.0.0' },
      { APP_ORIGIN: 'https://example.com' }]) {
      const altered = { ...env, ...changes }
      assert.throws(() => createDevEmailSender(altered, readConfig(altered)))
    }
    assert.equal(createDevEmailSender({ ...env, EMAIL_CODE_DEV_INBOX_FILE: undefined },
      readConfig(env)), null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
