import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import test from 'node:test'
import { sandbox } from './helpers/database.mjs'
import { AuthService } from '../dist/auth/auth.service.js'
import { readConfig } from '../dist/config.js'

test('legacy sessions have unknown provenance and cannot authorize passwordless identity linking', async () => {
  const db = await sandbox()
  try {
    const account = await db.client.account.create({
      data: { loginName: 'legacy', displayName: 'Legacy' }
    })
    const token = randomBytes(32).toString('base64url')
    await db.client.session.create({ data: {
      tokenHash: createHash('sha256').update(token).digest('hex'), accountId: account.id,
      expiresAt: new Date(Date.now() + 60_000)
    } })
    const auth = new AuthService(db.client, readConfig({ DATABASE_URL: db.url.toString(),
      APP_ORIGIN: 'http://localhost:3000' }))
    const existing = await auth.authenticate(`bazaar_session=${token}`)
    assert.equal(existing.authMethod, null)
    assert.equal(existing.authenticatedAt, null)
    await assert.rejects(auth.requireRecentAccountProof(existing, undefined, '127.0.0.1'),
      error => error.code === 'INVALID_CREDENTIALS')
  } finally { await db.close() }
})
