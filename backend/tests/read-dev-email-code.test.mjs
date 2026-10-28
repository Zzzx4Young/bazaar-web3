import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('local code reader selects the requested Gmail recipient and ignores expired codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bazaar-email-reader-'))
  try {
    const inbox = join(dir, 'inbox')
    writeFileSync(inbox, [
      { email: 'first@gmail.com', code: '111111', purpose: 'register',
        createdAt: new Date(Date.now() - 6 * 60_000).toISOString() },
      { email: 'second@gmail.com', code: '222222', purpose: 'login',
        createdAt: new Date().toISOString() },
      { email: 'first@gmail.com', code: '333333', purpose: 'register',
        createdAt: new Date().toISOString() }
    ].map(record => JSON.stringify(record)).join('\n') + '\n')
    const run = email => spawnSync(process.execPath,
      ['scripts/read-dev-email-code.mjs', '--email', email], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, EMAIL_CODE_DEV_INBOX_FILE: inbox }
      })
    const first = run('first@gmail.com')
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /333333/)
    assert.doesNotMatch(first.stdout, /111111|222222/)
    const absent = run('third@gmail.com')
    assert.notEqual(absent.status, 0)
    assert.doesNotMatch(absent.stdout + absent.stderr, /111111|222222|333333/)
    const missing = spawnSync(process.execPath,
      ['scripts/read-dev-email-code.mjs'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, EMAIL_CODE_DEV_INBOX_FILE: inbox }
      })
    assert.notEqual(missing.status, 0)
    assert.doesNotMatch(missing.stdout + missing.stderr, /111111|222222|333333/)
    const incomplete = spawnSync(process.execPath,
      ['scripts/read-dev-email-code.mjs', '--email', 'first@gmail.com', '--purpose'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, EMAIL_CODE_DEV_INBOX_FILE: inbox }
      })
    assert.notEqual(incomplete.status, 0)
    assert.doesNotMatch(incomplete.stdout + incomplete.stderr, /111111|222222|333333/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
