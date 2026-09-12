import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { sandbox, testUrl, cli, fixture } from '../tests/helpers/database.mjs'
import { runAppProcess } from '../tests/helpers/app-process.mjs'
import { hashPassword } from '../dist/auth/password.js'

// Explicit opt-in to restarting ONLY the dedicated Compose persistence service.
const base = testUrl(process.env.PERSISTENCE_TEST_DATABASE_URL, 'bazaar_persistence')
if (
  process.argv[2] !== '--restart-compose' ||
  base.hostname !== '127.0.0.1' ||
  base.port !== '55433'
) {
  throw new Error('Requires dedicated loopback persistence database and --restart-compose')
}

async function restart() {
  const child = spawn(
    'sudo',
    [
      '-n',
      'docker',
      'compose',
      '-f',
      '../infra/compose.validation.yaml',
      'restart',
      'postgres-validation'
    ],
    { stdio: 'inherit' }
  )
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', resolve)
  })
  assert.equal(code, 0, 'Dedicated validation container restart failed')
}

await mkdir('.tmp', { recursive: true })
const temporary = await mkdtemp(resolve('.tmp/persistence-'))
const db = await sandbox(base, false)
try {
  await mkdir(`${temporary}/migrations`)
  await cp(
    'prisma/migrations/202609110001_experiment',
    `${temporary}/migrations/202609110001_experiment`,
    { recursive: true }
  )
  await cp('prisma/migrations/migration_lock.toml', `${temporary}/migrations/migration_lock.toml`)
  const config = `${temporary}/prisma.config.ts`
  await writeFile(
    config,
    `import { defineConfig } from 'prisma/config'\nexport default defineConfig({ schema: ${JSON.stringify(resolve('prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(`${temporary}/migrations`)} }, datasource: { url: process.env.DATABASE_URL } })\n`
  )
  await cli(['migrate', 'deploy', '--config', config], db.url)
  const f = await fixture(db)
  const order = await db.client.order.create({
    data: { listingId: f.listing.id, buyerId: f.buyer, sellerId: f.seller }
  })
  await db.client.orderSnapshot.create({
    data: {
      orderId: order.id,
      listingVersion: 1,
      title: 'Historical snapshot',
      description: 'Virtual historical data',
      type: 'physical',
      category: 'test',
      priceAmount: f.listing.priceAmount,
      currency: 'TEST'
    }
  })
  await db.client.physicalInventory.update({
    where: { listingId: f.listing.id },
    data: { activeOrderId: order.id, availability: 'reserved' }
  })
  await db.client.inventoryReservation.create({
    data: { orderId: order.id, listingId: f.listing.id }
  })
  const eventId = randomUUID()
  const legacyDeliveryId = randomUUID()
  await db.client
    .$executeRaw`INSERT INTO "DeliveryRecord" ("id", "orderId", "sellerId", "sequence", "kind", "reference") VALUES (${legacyDeliveryId}::uuid, ${order.id}::uuid, ${f.seller}::uuid, 1, 'physical', 'legacy-tracking')`
  await db.client
    .$executeRaw`INSERT INTO "OrderEvent" ("id", "orderId", "actorId", "operation", "toState", "requestId") VALUES (${eventId}::uuid, ${order.id}::uuid, ${f.buyer}::uuid, 'create', 'pending_payment', 'historical-fixture')`
  const before = await db.read(async (client) => ({
    snapshot: await client.orderSnapshot.findUniqueOrThrow({ where: { orderId: order.id } }),
    inventory: await client.physicalInventory.findUniqueOrThrow({
      where: { listingId: f.listing.id }
    })
  }))
  const diff = await cli(
    [
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--script'
    ],
    db.url
  )
  assert.match(diff, /ADD COLUMN\s+"note" TEXT/)
  assert.doesNotMatch(diff, /DROP\s+(INDEX|TABLE|TRIGGER|FUNCTION|COLUMN)/i)
  // C1 replaces precisely these account-only FKs with order-participant composite FKs.
  const replaced = [...diff.matchAll(/DROP CONSTRAINT "([^"]+)"/g)].map((match) => match[1]).sort()
  assert.deepEqual(
    replaced,
    [
      'DeliveryRecord_orderId_fkey',
      'DeliveryRecord_sellerId_fkey',
      'IssueRecord_orderId_fkey',
      'IssueRecord_buyerId_fkey',
      'RefundRequest_requestedBy_fkey',
      'RefundRequest_approvedBy_fkey'
    ].sort()
  )
  await cli(['migrate', 'deploy'], db.url)
  const unchanged = await cli(
    [
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code'
    ],
    db.url
  )
  assert.match(unchanged, /No difference|empty migration/i)
  const legacy = await db.client.deliveryRecord.findUniqueOrThrow({
    where: { id: legacyDeliveryId }
  })
  assert.equal(legacy.carrier, null)
  assert.equal(legacy.accessCode, null)
  assert.equal(legacy.reference, 'legacy-tracking')
  const structured = await db.client.deliveryRecord.create({
    data: {
      orderId: order.id,
      sellerId: f.seller,
      sequence: 2,
      kind: 'physical',
      reference: 'new-tracking',
      carrier: 'Fixture carrier'
    }
  })
  const credential = await db.client.accountCredential.create({
    data: {
      accountId: f.buyer,
      passwordHash: await hashPassword('Virtual-persistence-password')
    }
  })
  const session = await db.client.session.create({
    data: {
      tokenHash: randomBytes(32).toString('hex'),
      accountId: f.buyer,
      expiresAt: new Date(Date.now() + 3600000)
    }
  })
  await runAppProcess(db.url)
  await db.database.onModuleDestroy()
  await restart()
  let ready = false
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await db.database.onModuleInit()
      ready = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  assert.equal(ready, true, 'Persistent database did not recover')
  await runAppProcess(db.url)
  await db.read(async (client) => {
    assert.deepEqual(
      await client.deliveryRecord.findUniqueOrThrow({ where: { id: legacy.id } }),
      legacy
    )
    assert.deepEqual(
      await client.deliveryRecord.findUniqueOrThrow({ where: { id: structured.id } }),
      structured
    )
    assert.deepEqual(
      await client.accountCredential.findUniqueOrThrow({ where: { accountId: f.buyer } }),
      credential
    )
    assert.deepEqual(
      await client.session.findUniqueOrThrow({ where: { tokenHash: session.tokenHash } }),
      session
    )
    assert.deepEqual(
      await client.orderSnapshot.findUniqueOrThrow({ where: { orderId: order.id } }),
      before.snapshot
    )
    assert.deepEqual(
      await client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } }),
      before.inventory
    )
    assert.equal((await client.orderEvent.findUniqueOrThrow({ where: { id: eventId } })).note, null)
    const indexes =
      await client.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = ${db.schema} AND indexname IN ('one_active_reservation', 'one_open_issue')`
    assert.equal(indexes.length, 2)
    const constraints =
      await client.$queryRaw`SELECT conname FROM pg_constraint WHERE connamespace = ${db.schema}::regnamespace AND contype = 'c'`
    assert.equal(constraints.length, 17)
    assert.equal(await client.order.count(), 1)
    await assert.rejects(
      client.orderSnapshot.update({ where: { orderId: order.id }, data: { title: 'tampered' } })
    )
    const duplicate = await client.order.create({
      data: { listingId: f.listing.id, buyerId: f.other, sellerId: f.seller }
    })
    await assert.rejects(
      client.inventoryReservation.create({
        data: { listingId: f.listing.id, orderId: duplicate.id }
      }),
      (error) => error.code === 'P2002'
    )
    await assert.rejects(
      client.physicalInventory.update({
        where: { listingId: f.listing.id },
        data: { availability: 'available' }
      })
    )
  })
  console.log(
    'DB-10 PASS: empty migration, historical upgrade, drift check, persistent container restart, compiled API process restart, data and manual constraints preserved'
  )
} finally {
  await db.close()
  await rm(temporary, { recursive: true, force: true })
}
