import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from '../tests/helpers/database.mjs'
import { grantRuntime } from './runtime-grants.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const suffix = randomUUID().replaceAll('-', '')
const schema = `commitment_preflight_${suffix}`
const role = `commitment_runtime_${suffix}`
const temporary = resolve(root, `.tmp/${schema}`)
const reportPath = resolve(root, '.tmp/product-commitment-migration-report.json')
const password = (await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url),
  'utf8')).trim()
const base = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
base.password = password
const target = new URL(base)
target.searchParams.set('schema', schema)
const admin = await connect(base)
let client, runtime, roleCreated = false, schemaCreated = false
const report = { schema, passed: false }

async function deploy(config) {
  const child = spawn(process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', config], {
      cwd: root, env: { ...process.env, DATABASE_URL: target.toString() },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  let output = ''
  for await (const chunk of child.stdout) output += chunk
  for await (const chunk of child.stderr) output += chunk
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', resolveExit)
  })
  assert.equal(code, 0, output.replaceAll(target.toString(), '[TEST_DATABASE_URL]'))
}

try {
  await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  schemaCreated = true
  await mkdir(resolve(temporary, 'migrations'), { recursive: true })
  const migrations = resolve(root, 'prisma/migrations')
  for (const name of await readdir(migrations)) {
    if (name === 'migration_lock.toml' || name < '202610310001_product_commitment')
      await cp(resolve(migrations, name), resolve(temporary, 'migrations', name),
        { recursive: true })
  }
  const configPath = resolve(temporary, 'prisma.config.ts')
  await writeFile(configPath, `import { defineConfig } from 'prisma/config'\n` +
    `export default defineConfig({ schema: ${JSON.stringify(resolve(root, 'prisma/schema.prisma'))}, ` +
    `migrations: { path: ${JSON.stringify(resolve(temporary, 'migrations'))} }, ` +
    `datasource: { url: process.env.DATABASE_URL } })\n`)
  await deploy(configPath)
  client = await connect(target)
  const seller = randomUUID(), buyer = randomUUID()
  const excluded = randomUUID(), ordinary = randomUUID()
  const open = randomUUID(), completed = randomUUID()
  for (const [id, name] of [[seller, 'seller'], [buyer, 'buyer']])
    await client.client.$executeRawUnsafe(
      'INSERT INTO "Account" ("id","loginName","displayName") VALUES ($1::uuid,$2::varchar(100),$2::text)',
      id, `preflight-${name}-${suffix}`)
  for (const [id, title] of [[excluded, '版权转让的旧商品'], [ordinary, '普通旧商品']])
    await client.client.$executeRawUnsafe(
      `INSERT INTO "Listing" ("id","sellerId","type","title","description",` +
      `"category","priceAmount","currency","updatedAt") ` +
      `VALUES ($1::uuid,$2::uuid,'physical',$3,'Historical fixture','electronics',10,'USD',now())`,
      id, seller, title)
  for (const [id, status] of [[open, 'pending_payment'], [completed, 'completed']]) {
    await client.client.$executeRawUnsafe(
      `INSERT INTO "Order" ("id","listingId","buyerId","sellerId","status","updatedAt") ` +
      `VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,now())`,
      id, excluded, buyer, seller, status)
    await client.client.$executeRawUnsafe(
      `INSERT INTO "OrderSnapshot" ("orderId","listingVersion","title","description",` +
      `"type","category","priceAmount","currency") ` +
      `VALUES ($1::uuid,1,'Historical snapshot','Historical fixture','physical',` +
      `'electronics',10,'USD')`, id)
  }
  const before = await client.client.$queryRawUnsafe(`SELECT
    (SELECT count(*)::int FROM "Listing") AS "legacyListings",
    (SELECT count(*)::int FROM "Listing" WHERE
      ("title" || ' ' || "description" || ' ' || coalesce("licenseDescription", ''))
      ~* '(版权.{0,8}(转让|出售|买断)|著作权.{0,8}(转让|出售|买断)|所有权.{0,8}(转让|出售|买断)|独家产权|独占产权|独家所有权|copyright[[:space:]]+(transfer|assignment|sale)|exclusive[[:space:]]+(ownership|property[[:space:]]+rights))') AS "claimHits",
    (SELECT count(*)::int FROM "Order" WHERE "listingId" = $1::uuid) AS "relatedOrders",
    (SELECT count(*)::int FROM "Order" WHERE "listingId" = $1::uuid
      AND status IN ('pending_payment','pending_delivery','pending_acceptance','issue')) AS "ordersToPause"`,
  excluded)
  report.preview = before[0]
  assert.deepEqual(report.preview, {
    legacyListings: 2, claimHits: 1, relatedOrders: 2, ordersToPause: 1
  })
  await client.onModuleDestroy()
  client = null
  await deploy(resolve(root, 'prisma.config.ts'))
  client = await connect(target)
  report.after = {
    pausedListings: await client.client.listing.count({ where: { reviewStatus: 'paused' } }),
    pausedOrders: await client.client.order.count({ where: { transactionPausedAt: { not: null } } }),
    listingAudit: await client.client.listingReviewEvent.count({ where: { action: 'legacy_claim_pause' } }),
    orderAudit: await client.client.orderEvent.count({ where: { operation: 'listing_review_pause' } }),
    unchangedSnapshot: (await client.client.orderSnapshot.findUniqueOrThrow({
      where: { orderId: completed }
    })).title === 'Historical snapshot',
    completedOrderUnpaused: (await client.client.order.findUniqueOrThrow({
      where: { id: completed }
    })).transactionPausedAt === null
  }
  assert.deepEqual(report.after, { pausedListings: 1, pausedOrders: 1,
    listingAudit: 1, orderAudit: 1, unchangedSnapshot: true, completedOrderUnpaused: true })
  const runtimePassword = randomUUID()
  await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${runtimePassword}'`)
  roleCreated = true
  await grantRuntime(client.client, schema, role)
  const runtimeUrl = new URL(target)
  runtimeUrl.username = role
  runtimeUrl.password = runtimePassword
  runtime = await connect(runtimeUrl)
  assert.equal(await runtime.client.listingReviewEvent.count(), 1)
  report.runtimeRoleCanReadAudit = true
  report.passed = true
} finally {
  await runtime?.onModuleDestroy()
  await client?.onModuleDestroy()
  if (schemaCreated) await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
  if (roleCreated) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
  await admin.onModuleDestroy()
  await rm(temporary, { recursive: true, force: true })
  await mkdir(resolve(root, '.tmp'), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(report))
}
