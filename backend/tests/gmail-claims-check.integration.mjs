import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { sandbox } from './helpers/database.mjs'

test('read-only claim diagnostic reports drift without changing ownership', async () => {
  const db = await sandbox()
  const check = () => spawnSync(process.execPath, ['scripts/check-gmail-claims.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, DATABASE_URL: db.url.toString(), APP_ORIGIN: 'http://localhost:3000' }
  })
  try {
    const account = await db.client.account.create({
      data: { loginName: 'check.claim@gmail.com', displayName: 'Check' }
    })
    await db.client.gmailClaim.create({ data: {
      key: 'checkclaim@gmail.com', accountId: account.id
    } })
    const clean = check()
    assert.equal(clean.status, 0, clean.stderr)
    assert.equal(JSON.parse(clean.stdout).issues, 0)
    await db.client.gmailClaim.delete({ where: { key: 'checkclaim@gmail.com' } })
    const drift = check()
    assert.equal(drift.status, 1, drift.stderr)
    assert.deepEqual(JSON.parse(drift.stdout).counts, { missing: 1 })
    assert.doesNotMatch(drift.stdout, /check\.claim@gmail\.com/)
    assert.equal(await db.client.gmailClaim.count(), 0)
  } finally { await db.close() }
})
