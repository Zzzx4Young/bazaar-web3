import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sandbox } from './helpers/database.mjs'

const migration = new URL('../prisma/migrations/202610280001_legacy_google_claims/migration.sql', import.meta.url)

test('legacy Google claim backfill reserves absent claims and rejects conflicting owners', async () => {
  const db = await sandbox()
  try {
    const sql = await readFile(migration, 'utf8')
    const owner = await db.client.account.create({ data: {
      loginName: 'legacy-google-user', displayName: 'Legacy Google'
    } })
    await db.client.accountIdentity.create({ data: {
      accountId: owner.id, provider: 'google', subject: 'legacy-google-sub',
      email: 'Legacy.User+tag@gmail.com'
    } })
    assert.equal(await db.client.gmailClaim.count(), 0)
    await db.client.$executeRawUnsafe(sql)
    assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
      where: { key: 'legacyuser@gmail.com' }
    })).accountId, owner.id)

    const other = await db.client.account.create({ data: {
      loginName: 'other-google-user', displayName: 'Other'
    } })
    await db.client.gmailClaim.create({ data: {
      key: 'conflict@gmail.com', accountId: other.id
    } })
    await db.client.accountIdentity.update({
      where: { provider_subject: { provider: 'google', subject: 'legacy-google-sub' } },
      data: { email: 'conflict@gmail.com' }
    })
    await assert.rejects(db.client.$executeRawUnsafe(sql), /Conflicting historical Google/)
    assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
      where: { key: 'conflict@gmail.com' }
    })).accountId, other.id)
  } finally { await db.close() }
})
