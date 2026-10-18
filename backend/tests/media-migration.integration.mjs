import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { sandbox } from './helpers/database.mjs'

test('sale-mode migration maps legacy physical, single digital and unlimited digital rows', async () => {
  const db = await sandbox(undefined, false)
  try {
    await db.client.$executeRawUnsafe('CREATE TABLE "Listing" (id UUID PRIMARY KEY, type TEXT NOT NULL)')
    await db.client.$executeRawUnsafe('CREATE TABLE "DigitalInventory" ("listingId" UUID PRIMARY KEY)')
    const physical = randomUUID(), single = randomUUID(), unlimited = randomUUID()
    for (const [id, type] of [[physical, 'physical'], [single, 'digital'], [unlimited, 'digital']])
      await db.client.$executeRaw`INSERT INTO "Listing" (id, type) VALUES (${id}::uuid, ${type})`
    await db.client.$executeRaw`INSERT INTO "DigitalInventory" ("listingId") VALUES (${single}::uuid)`
    const sql = await readFile(new URL('../prisma/migrations/202610170001_listing_sale_mode/migration.sql',
      import.meta.url), 'utf8')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean))
      await db.client.$executeRawUnsafe(statement)
    const rows = await db.client.$queryRaw`SELECT id::text, "saleMode" FROM "Listing"`
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.saleMode])), {
      [physical]: 'one_off', [single]: 'one_off', [unlimited]: 'repeatable'
    })
  } finally {
    await db.close()
  }
})
