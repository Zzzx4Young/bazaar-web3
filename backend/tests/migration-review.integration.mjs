import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, cp, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { sandbox, testUrl, cli } from './helpers/database.mjs'

test('C1 upgrade rejects invalid historical prices atomically and supports explicit repair', async () => {
  await mkdir('.tmp', { recursive: true })
  const directory = await mkdtemp(resolve('.tmp/review-upgrade-'))
  const db = await sandbox(testUrl(), false)
  try {
    await mkdir(`${directory}/migrations`)
    for (const name of [
      '202609110001_experiment',
      '202609110002_event_note',
      'migration_lock.toml'
    ]) {
      await cp(`prisma/migrations/${name}`, `${directory}/migrations/${name}`, { recursive: true })
    }
    const config = `${directory}/prisma.config.ts`
    await writeFile(
      config,
      `import { defineConfig } from 'prisma/config'\nexport default defineConfig({ schema: ${JSON.stringify(resolve('prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(`${directory}/migrations`)} }, datasource: { url: process.env.DATABASE_URL } })\n`
    )
    await cli(['migrate', 'deploy', '--config', config], db.url)
    // Seed through the historical SQL shape. The current Prisma model includes
    // columns that intentionally do not exist at this migration checkpoint.
    const sellerId = randomUUID()
    const listingId = randomUUID()
    const priceAmount = '12.5'
    await db.client.$executeRaw`INSERT INTO "Account" ("id", "loginName", "displayName")
      VALUES (${sellerId}::uuid, ${randomUUID()}, 'Historical seller')`
    await db.client.$executeRaw`INSERT INTO "Listing"
      ("id", "sellerId", "type", "title", "description", "category", "priceAmount", "currency", "updatedAt")
      VALUES (${listingId}::uuid, ${sellerId}::uuid, 'physical', 'Historical listing',
        'Legacy fixture', 'test', ${priceAmount}::numeric, 'TEST', CURRENT_TIMESTAMP)`
    await db.client.$executeRaw`INSERT INTO "PhysicalInventory" ("listingId") VALUES (${listingId}::uuid)`
    const buyerId = randomUUID()
    const orderId = randomUUID()
    await db.client.$executeRaw`INSERT INTO "Account" ("id", "loginName", "displayName")
      VALUES (${buyerId}::uuid, ${randomUUID()}, 'Historical buyer')`
    await db.client.$executeRaw`INSERT INTO "Order"
      ("id", "listingId", "buyerId", "sellerId", "status", "updatedAt")
      VALUES (${orderId}::uuid, ${listingId}::uuid, ${buyerId}::uuid,
        ${sellerId}::uuid, 'completed', CURRENT_TIMESTAMP)`
    await db.client.$executeRaw`INSERT INTO "OrderSnapshot"
      ("orderId", "listingVersion", "title", "description", "type", "category", "priceAmount", "currency")
      VALUES (${orderId}::uuid, 1, 'Historical listing', 'Legacy fixture', 'physical',
        'test', ${priceAmount}::numeric, 'TEST')`
    await db.client.$executeRaw`UPDATE "PhysicalInventory"
      SET "availability" = 'sold', "activeOrderId" = ${orderId}::uuid
      WHERE "listingId" = ${listingId}::uuid`
    await db.client.$executeRaw`INSERT INTO "InventoryReservation"
      ("id", "listingId", "orderId", "state", "closedAt")
      VALUES (${randomUUID()}::uuid, ${listingId}::uuid, ${orderId}::uuid,
        'completed', CURRENT_TIMESTAMP)`
    await db.client.$executeRaw`INSERT INTO "SettlementRecord"
      ("id", "orderId", "operation", "amount", "currency")
      VALUES (${randomUUID()}::uuid, ${orderId}::uuid, 'payment', ${priceAmount}::numeric, 'TEST')`
    await db.client
      .$executeRaw`UPDATE "Listing" SET "priceAmount" = 'NaN'::numeric WHERE "id" = ${listingId}::uuid`
    await assert.rejects(cli(['migrate', 'deploy'], db.url), /current transaction is aborted|listing_finite_price/)
    await db.read(async (client) => {
      const oldKeys =
        await client.$queryRaw`SELECT conname FROM pg_constraint WHERE connamespace = ${db.schema}::regnamespace AND conname = 'DeliveryRecord_sellerId_fkey'`
      assert.equal(oldKeys.length, 1, 'FK replacement must roll back with the failed migration')
      assert.equal((await client.$queryRaw`SELECT count(*)::int AS count FROM "Listing"`)[0].count, 1)
    })
    // Explicitly repair this intentionally corrupted fixture; migration never auto-cleans data.
    await db.client.$executeRaw`UPDATE "Listing" SET "priceAmount" = ${priceAmount}::numeric
      WHERE "id" = ${listingId}::uuid`
    await cli(['migrate', 'resolve', '--rolled-back', '202609120001_core_integrity'], db.url)
    await cli(['migrate', 'deploy'], db.url)
    await db.read(async (client) => {
      assert.equal(
        (
          await client.listing.findUniqueOrThrow({ where: { id: listingId } })
        ).priceAmount.toFixed(18),
        '12.500000000000000000'
      )
      const keys =
        await client.$queryRaw`SELECT conname FROM pg_constraint WHERE connamespace = ${db.schema}::regnamespace AND conname = 'DeliveryRecord_orderId_sellerId_fkey'`
      assert.equal(keys.length, 1)
      const settlements = await client.settlementRecord.findMany({
        where: { orderId }, orderBy: { operation: 'asc' }
      })
      assert.deepEqual(settlements.map((row) => row.operation), ['payment', 'release'])
      assert.equal(settlements[1].amount.toFixed(18), '12.500000000000000000')
    })
  } finally {
    await db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
