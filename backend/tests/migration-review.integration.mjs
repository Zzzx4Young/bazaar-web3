import assert from 'node:assert/strict'
import { mkdir, mkdtemp, cp, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { sandbox, testUrl, fixture, cli } from './helpers/database.mjs'

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
    const f = await fixture(db)
    await db.client
      .$executeRaw`UPDATE "Listing" SET "priceAmount" = 'NaN'::numeric WHERE "id" = ${f.listing.id}::uuid`
    await assert.rejects(cli(['migrate', 'deploy'], db.url), /current transaction is aborted|listing_finite_price/)
    await db.read(async (client) => {
      const oldKeys =
        await client.$queryRaw`SELECT conname FROM pg_constraint WHERE connamespace = ${db.schema}::regnamespace AND conname = 'DeliveryRecord_sellerId_fkey'`
      assert.equal(oldKeys.length, 1, 'FK replacement must roll back with the failed migration')
      assert.equal(await client.listing.count(), 1)
    })
    // Explicitly repair this intentionally corrupted fixture; migration never auto-cleans data.
    await db.client.listing.update({
      where: { id: f.listing.id },
      data: { priceAmount: f.listing.priceAmount }
    })
    await cli(['migrate', 'resolve', '--rolled-back', '202609120001_core_integrity'], db.url)
    await cli(['migrate', 'deploy'], db.url)
    await db.read(async (client) => {
      assert.equal(
        (
          await client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })
        ).priceAmount.toFixed(18),
        f.listing.priceAmount.toFixed(18)
      )
      const keys =
        await client.$queryRaw`SELECT conname FROM pg_constraint WHERE connamespace = ${db.schema}::regnamespace AND conname = 'DeliveryRecord_orderId_sellerId_fkey'`
      assert.equal(keys.length, 1)
    })
  } finally {
    await db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
