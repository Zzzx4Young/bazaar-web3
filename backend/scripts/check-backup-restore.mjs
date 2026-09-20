import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseService } from '../dist/database/database.service.js'
import { OrderCommands } from '../dist/orders/order-commands.js'
import { hashPassword } from '../dist/auth/password.js'
import { cli, fixture } from '../tests/helpers/database.mjs'
import { grantRuntime } from './runtime-grants.mjs'
import { grantObserver } from './observer-grants.mjs'
import { expectedMigrationNames } from './expected-migrations.mjs'

const base = new URL(process.env.BACKUP_TEST_DATABASE_URL ?? '')
if (
  process.argv[2] !== '--restart-compose' ||
  base.protocol !== 'postgresql:' ||
  base.hostname !== '127.0.0.1' ||
  base.port !== '55433' ||
  base.pathname !== '/bazaar_persistence'
)
  throw new Error('Requires the dedicated loopback persistence database and --restart-compose')

process.umask(0o077)
const suffix = randomBytes(6).toString('hex')
const sourceDatabase = `i8_source_${suffix}`
const restoreDatabase = `i8_restore_${suffix}`
const migrationRole = `i8_m_${suffix}`
const runtimeRole = `i8_r_${suffix}`
const observerRole = `i8_o_${suffix}`
const migrationPassword = randomBytes(32).toString('base64url')
const runtimePassword = randomBytes(32).toString('base64url')
const observerPassword = randomBytes(32).toString('base64url')
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`
const literal = (value) => `'${value.replaceAll("'", "''")}'`
const denied = (error) =>
  ['25006', '42501'].includes(
    error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode
  )

const targetUrl = (database, role, password, schema = 'bazaar') => {
  const url = new URL(base)
  url.pathname = `/${database}`
  url.username = role
  url.password = password
  url.searchParams.set('schema', schema)
  return url
}

const run = async (command, args, password, capture = false) => {
  const child = spawn(command, args, {
    env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })
  let output = ''
  if (capture) {
    child.stdout.on('data', (data) => {
      output += data
    })
    child.stderr.on('data', (data) => {
      output += data
    })
  }
  const code = await new Promise((resolveCode, reject) => {
    child.on('error', reject)
    child.on('exit', resolveCode)
  })
  assert.equal(code, 0, `${command} failed${capture ? `: ${output}` : ''}`)
  return output
}

const connectWithRetry = async (url) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const connection = new DatabaseService(url.toString())
    try {
      await connection.onModuleInit()
      return connection
    } catch {
      await connection.onModuleDestroy().catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
  }
  throw new Error('Persistent database did not become ready after restart')
}

const close = async (connection) => connection?.onModuleDestroy().catch(() => undefined)
let admin
let sourceAdmin
let sourceMigration
let restoreMigration
let restoreRuntime
let restoreObserver
const databasesCreated = []
const rolesCreated = []
let cleanupFailed = false
let stage = 'initialize'
await mkdir('.tmp', { recursive: true, mode: 0o700 })
await chmod('.tmp', 0o700)
const temporary = await mkdtemp(resolve('.tmp/backup-restore-'))
const archive = resolve(temporary, 'bazaar.dump')

try {
  stage = 'connect administrator'
  admin = new DatabaseService(base.toString())
  await admin.onModuleInit()
  for (const [role, password] of [
    [migrationRole, migrationPassword],
    [runtimeRole, runtimePassword],
    [observerRole, observerPassword]
  ]) {
    stage = 'create restricted roles'
    await admin.client.$executeRawUnsafe(
      `CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)}`
    )
    rolesCreated.push(role)
  }
  await admin.client.$executeRawUnsafe(
    `ALTER ROLE ${quote(observerRole)} SET default_transaction_read_only = on`
  )
  await admin.client.$executeRawUnsafe(`ALTER ROLE ${quote(observerRole)} SET statement_timeout = '3s'`)
  await admin.client.$executeRawUnsafe(
    `ALTER ROLE ${quote(observerRole)} SET idle_in_transaction_session_timeout = '3s'`
  )
  await admin.client.$executeRawUnsafe(
    `ALTER ROLE ${quote(observerRole)} SET search_path = bazaar_observe, pg_catalog`
  )

  stage = 'create source database'
  await admin.client.$executeRawUnsafe(`CREATE DATABASE ${quote(sourceDatabase)}`)
  databasesCreated.push(sourceDatabase)
  const sourceAdminUrl = targetUrl(
    sourceDatabase,
    decodeURIComponent(base.username),
    decodeURIComponent(base.password),
    'public'
  )
  sourceAdmin = new DatabaseService(sourceAdminUrl.toString())
  await sourceAdmin.onModuleInit()
  await sourceAdmin.client.$executeRawUnsafe(
    `CREATE SCHEMA bazaar AUTHORIZATION ${quote(migrationRole)}`
  )
  await sourceAdmin.client.$executeRawUnsafe(
    `CREATE SCHEMA bazaar_observe AUTHORIZATION ${quote(migrationRole)}`
  )
  await sourceAdmin.client.$executeRawUnsafe('REVOKE ALL ON SCHEMA bazaar, bazaar_observe FROM PUBLIC')

  stage = 'migrate and populate source'
  const sourceMigrationUrl = targetUrl(sourceDatabase, migrationRole, migrationPassword)
  await cli(['migrate', 'deploy'], sourceMigrationUrl)
  sourceMigration = new DatabaseService(sourceMigrationUrl.toString())
  await sourceMigration.onModuleInit()
  await grantRuntime(sourceMigration.client, 'bazaar', runtimeRole)
  await grantObserver(sourceMigration.client, 'bazaar', 'bazaar_observe', observerRole)
  const f = await fixture(sourceMigration)
  const orderId = await new OrderCommands(sourceMigration.client).create(
    f.buyer,
    randomUUID(),
    f.input
  )
  const passwordHash = await hashPassword('I8 virtual backup password')
  const tokenHash = randomBytes(32).toString('hex')
  await sourceMigration.client.accountCredential.create({
    data: { accountId: f.buyer, passwordHash }
  })
  await sourceMigration.client.session.create({
    data: { tokenHash, accountId: f.buyer, expiresAt: new Date(Date.now() + 3600000) }
  })
  const sourceCounts = {
    accounts: await sourceMigration.client.account.count(),
    listings: await sourceMigration.client.listing.count(),
    orders: await sourceMigration.client.order.count(),
    events: await sourceMigration.client.orderEvent.count(),
    idempotency: await sourceMigration.client.idempotencyRecord.count(),
    sessions: await sourceMigration.client.session.count()
  }
  await close(sourceMigration)
  sourceMigration = undefined
  await close(sourceAdmin)
  sourceAdmin = undefined

  stage = 'create custom-format backup'
  await run(
    'pg_dump',
    [
      '--host',
      base.hostname,
      '--port',
      base.port,
      '--username',
      migrationRole,
      '--dbname',
      sourceDatabase,
      '--format=custom',
      '--file',
      archive,
      '--no-password'
    ],
    migrationPassword
  )
  assert.equal((await stat(archive)).mode & 0o777, 0o600)
  assert.ok((await stat(archive)).size > 0, 'Backup archive is empty')
  const archiveList = await run('pg_restore', ['--list', archive], undefined, true)
  for (const expected of ['TABLE DATA bazaar Account', 'TABLE DATA bazaar Order', 'SCHEMA bazaar_observe'])
    assert.match(archiveList, new RegExp(expected))

  stage = 'restore into empty database'
  await admin.client.$executeRawUnsafe(`CREATE DATABASE ${quote(restoreDatabase)}`)
  databasesCreated.push(restoreDatabase)
  await run(
    'pg_restore',
    [
      '--host',
      base.hostname,
      '--port',
      base.port,
      '--username',
      decodeURIComponent(base.username),
      '--dbname',
      restoreDatabase,
      '--exit-on-error',
      '--no-password',
      archive
    ],
    decodeURIComponent(base.password)
  )

  stage = 'connect restored roles'
  const restoreMigrationUrl = targetUrl(restoreDatabase, migrationRole, migrationPassword)
  const restoreRuntimeUrl = targetUrl(restoreDatabase, runtimeRole, runtimePassword)
  const restoreObserverUrl = targetUrl(
    restoreDatabase,
    observerRole,
    observerPassword,
    'bazaar_observe'
  )
  restoreMigration = new DatabaseService(restoreMigrationUrl.toString())
  await restoreMigration.onModuleInit()
  stage = 'verify restored migrations'
  const migrations =
    await restoreMigration.client.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`
  assert.deepEqual(migrations.map((item) => item.migration_name), expectedMigrationNames())
  stage = 'verify restored row counts'
  assert.deepEqual(
    {
      accounts: await restoreMigration.client.account.count(),
      listings: await restoreMigration.client.listing.count(),
      orders: await restoreMigration.client.order.count(),
      events: await restoreMigration.client.orderEvent.count(),
      idempotency: await restoreMigration.client.idempotencyRecord.count(),
      sessions: await restoreMigration.client.session.count()
    },
    sourceCounts
  )
  stage = 'verify restored private records'
  assert.equal(
    (await restoreMigration.client.accountCredential.findUniqueOrThrow({ where: { accountId: f.buyer } }))
      .passwordHash,
    passwordHash
  )
  assert.equal(
    (await restoreMigration.client.session.findUniqueOrThrow({ where: { tokenHash } })).accountId,
    f.buyer
  )
  stage = 'verify restored immutable constraints'
  await assert.rejects(
    restoreMigration.client.orderSnapshot.update({
      where: { orderId },
      data: { title: 'forbidden restored mutation' }
    })
  )
  stage = 'verify restored migration drift'
  const diff = await cli(
    ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'],
    restoreMigrationUrl
  )
  assert.match(diff, /No difference|empty migration/i)

  stage = 'verify restored runtime permissions'
  restoreRuntime = new DatabaseService(restoreRuntimeUrl.toString())
  await restoreRuntime.onModuleInit()
  assert.equal(await restoreRuntime.client.order.count(), 1)
  await assert.rejects(restoreRuntime.client.$queryRawUnsafe('SELECT * FROM "_prisma_migrations"'), denied)
  await assert.rejects(restoreRuntime.client.$executeRawUnsafe('CREATE TABLE forbidden (id int)'), denied)
  stage = 'verify restored business write'
  await new OrderCommands(restoreRuntime.client).act(f.buyer, randomUUID(), orderId, 'pay')
  assert.equal(
    (await restoreRuntime.client.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    'pending_delivery'
  )

  stage = 'verify restored observer permissions'
  restoreObserver = new DatabaseService(restoreObserverUrl.toString())
  await restoreObserver.onModuleInit()
  const observerProof = await restoreObserver.client.$queryRawUnsafe(
    `SELECT current_user, current_setting('default_transaction_read_only') AS read_only,
      (SELECT count(*)::int FROM information_schema.views
       WHERE table_schema = 'bazaar_observe') AS views`
  )
  assert.deepEqual(observerProof, [{ current_user: observerRole, read_only: 'on', views: 16 }])
  await assert.rejects(restoreObserver.client.$queryRawUnsafe('SELECT * FROM bazaar."Account"'), denied)
  await assert.rejects(restoreObserver.client.$executeRawUnsafe('CREATE TABLE forbidden (id int)'), denied)

  stage = 'restart dedicated database after restore'
  await close(restoreObserver)
  restoreObserver = undefined
  await close(restoreRuntime)
  restoreRuntime = undefined
  await close(restoreMigration)
  restoreMigration = undefined
  await close(admin)
  admin = undefined
  await run('sudo', [
    '-n',
    'docker',
    'compose',
    '-f',
    '../infra/compose.validation.yaml',
    'restart',
    'postgres-validation'
  ])

  stage = 'verify restored data after restart'
  restoreRuntime = await connectWithRetry(restoreRuntimeUrl)
  assert.equal(
    (await restoreRuntime.client.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    'pending_delivery'
  )
  assert.equal(await restoreRuntime.client.settlementRecord.count(), 1)
  sourceMigration = await connectWithRetry(sourceMigrationUrl)
  assert.equal(
    (await sourceMigration.client.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    'pending_payment'
  )
  console.log(
    `I8-1 PASS: private custom backup, clean restore, ${migrations.length} migrations, exact data, runtime/observer restrictions, business write and restart persistence verified`
  )
} catch {
  console.error(`I8-1 backup/restore failed during ${stage}; no credentials or private values were logged`)
  process.exitCode = 1
} finally {
  await close(restoreObserver)
  await close(restoreRuntime)
  await close(restoreMigration)
  await close(sourceMigration)
  await close(sourceAdmin)
  if (!admin) admin = await connectWithRetry(base).catch(() => undefined)
  if (admin) {
    for (const database of databasesCreated.reverse()) {
      try {
        await admin.client.$executeRawUnsafe(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${literal(database)} AND pid <> pg_backend_pid()`
        )
        await admin.client.$executeRawUnsafe(`DROP DATABASE ${quote(database)}`)
      } catch {
        cleanupFailed = true
      }
    }
    for (const role of rolesCreated.reverse()) {
      try {
        await admin.client.$executeRawUnsafe(`DROP ROLE ${quote(role)}`)
      } catch {
        cleanupFailed = true
      }
    }
  } else if (databasesCreated.length > 0 || rolesCreated.length > 0) cleanupFailed = true
  await close(admin)
  await rm(temporary, { recursive: true, force: true })
  if (cleanupFailed) {
    console.error('I8-1 cleanup failed; inspect the dedicated validation service')
    process.exitCode = 1
  }
}
