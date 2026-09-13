import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { cli } from '../tests/helpers/database.mjs'
import { grantRuntime } from './runtime-grants.mjs'

const base = new URL(process.env.I7_ADMIN_DATABASE_URL ?? '')
if (
  process.argv[2] !== '--restart-compose' ||
  base.protocol !== 'postgresql:' ||
  base.hostname !== '127.0.0.1' ||
  base.port !== '55433' ||
  base.pathname !== '/bazaar_persistence'
)
  throw new Error('Requires the dedicated loopback persistence database and --restart-compose')

const suffix = randomBytes(6).toString('hex')
const databaseName = `i7_${suffix}`
const migrationRole = `i7_m_${suffix}`
const runtimeRole = `i7_r_${suffix}`
const migrationPassword = randomBytes(32).toString('base64url')
const runtimePassword = randomBytes(32).toString('base64url')
const accountPassword = randomBytes(32).toString('base64url')
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`
const permissionDenied = (error) =>
  (error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode) === '42501'

const targetUrl = (role, password, schema = 'bazaar') => {
  const url = new URL(base)
  url.pathname = `/${databaseName}`
  url.username = role
  url.password = password
  url.searchParams.set('schema', schema)
  return url
}

const run = async (command, args, env = process.env) => {
  const child = spawn(command, args, { stdio: 'inherit', env })
  const code = await new Promise((resolveCode, reject) => {
    child.on('error', reject)
    child.on('exit', resolveCode)
  })
  assert.equal(code, 0, `${command} failed`)
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

let admin
let targetAdmin
let migration
let runtime
let app
let databaseCreated = false
const rolesCreated = []
let stage = 'initialize'
let cleanupFailed = false
await mkdir('.tmp', { recursive: true, mode: 0o700 })
await chmod('.tmp', 0o700)
const temporary = await mkdtemp(resolve('.tmp/i7-environment-'))
const accountsFile = resolve(temporary, 'accounts.json')

try {
  stage = 'connect administrator'
  admin = new DatabaseService(base.toString())
  await admin.onModuleInit()
  for (const [role, password] of [
    [migrationRole, migrationPassword],
    [runtimeRole, runtimePassword]
  ]) {
    stage = 'create restricted roles'
    await admin.client.$executeRawUnsafe(
      `CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
    )
    rolesCreated.push(role)
  }
  stage = 'create empty database'
  await admin.client.$executeRawUnsafe(`CREATE DATABASE ${quote(databaseName)}`)
  databaseCreated = true

  stage = 'create owned schema'
  const targetAdminUrl = new URL(base)
  targetAdminUrl.pathname = `/${databaseName}`
  targetAdminUrl.searchParams.set('schema', 'public')
  targetAdmin = new DatabaseService(targetAdminUrl.toString())
  await targetAdmin.onModuleInit()
  await targetAdmin.client.$executeRawUnsafe(
    `CREATE SCHEMA bazaar AUTHORIZATION ${quote(migrationRole)}`
  )
  await targetAdmin.client.$executeRawUnsafe('REVOKE ALL ON SCHEMA bazaar FROM PUBLIC')

  stage = 'deploy migrations'
  const migrationUrl = targetUrl(migrationRole, migrationPassword)
  const runtimeUrl = targetUrl(runtimeRole, runtimePassword)
  await cli(['migrate', 'deploy'], migrationUrl)
  stage = 'grant runtime access'
  migration = new DatabaseService(migrationUrl.toString())
  await migration.onModuleInit()
  await grantRuntime(migration.client, 'bazaar', runtimeRole)

  stage = 'provision accounts'
  await writeFile(
    accountsFile,
    JSON.stringify(
      ['seller', 'buyer', 'outsider'].map((name) => ({
        loginName: `i7-${name}-${suffix}`,
        displayName: `I7 ${name}`,
        password: accountPassword
      }))
    ),
    { mode: 0o600, flag: 'wx' }
  )
  await run(process.execPath, ['scripts/provision-accounts.mjs'], {
    ...process.env,
    DATABASE_URL: migrationUrl.toString(),
    SEED_ACCOUNTS_FILE: accountsFile
  })

  stage = 'verify runtime restrictions'
  runtime = new DatabaseService(runtimeUrl.toString())
  await runtime.onModuleInit()
  assert.equal(await runtime.client.account.count(), 3)
  await assert.rejects(runtime.client.$executeRawUnsafe('CREATE TABLE forbidden (id int)'), permissionDenied)
  stage = 'start API'
  app = await createApp(readConfig({ DATABASE_URL: runtimeUrl.toString() }), false)
  stage = 'verify ready endpoint'
  const ready = await app.inject({
    method: 'POST',
    url: '/api/health/ready',
    headers: { origin: 'http://localhost:3000' },
    payload: {}
  })
  if (ready.statusCode !== 200)
    console.error(`Ready endpoint returned ${ready.statusCode}: ${ready.body}`)
  assert.equal(ready.statusCode, 200, ready.body)
  stage = 'verify login'
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: 'http://localhost:3000' },
    payload: { loginName: `i7-buyer-${suffix}`, password: accountPassword }
  })
  assert.equal(login.statusCode, 200)
  stage = 'verify logout'
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          origin: 'http://localhost:3000',
          cookie: login.headers['set-cookie'].split(';')[0],
          'x-csrf-token': login.json().csrfToken
        },
        payload: {}
      })
    ).statusCode,
    204
  )

  stage = 'close connections before restart'
  await app.close()
  app = undefined
  await runtime.onModuleDestroy()
  runtime = undefined
  await migration.onModuleDestroy()
  migration = undefined
  await targetAdmin.onModuleDestroy()
  targetAdmin = undefined
  await admin.onModuleDestroy()
  admin = undefined

  stage = 'restart dedicated database'
  await run('sudo', [
    '-n',
    'docker',
    'compose',
    '-f',
    '../infra/compose.validation.yaml',
    'restart',
    'postgres-validation'
  ])

  stage = 'verify data after restart'
  runtime = await connectWithRetry(targetUrl(runtimeRole, runtimePassword))
  assert.equal(await runtime.client.account.count(), 3)
  migration = new DatabaseService(targetUrl(migrationRole, migrationPassword).toString())
  await migration.onModuleInit()
  const migrations = await migration.client.$queryRaw`SELECT COUNT(*)::int AS count FROM "_prisma_migrations"`
  assert.equal(migrations[0].count, 6)
  console.log('I7 fresh persistent environment passed: 6 migrations, 3 accounts, restart and runtime restriction')
} catch {
  console.error(`I7 fresh persistent environment failed during ${stage}; no secrets were logged`)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => undefined)
  await runtime?.onModuleDestroy().catch(() => undefined)
  await migration?.onModuleDestroy().catch(() => undefined)
  await targetAdmin?.onModuleDestroy().catch(() => undefined)
  if (!admin) {
    admin = await connectWithRetry(base).catch(() => undefined)
  }
  if (admin && databaseCreated) {
    try {
      await admin.client.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`
      )
      await admin.client.$executeRawUnsafe(`DROP DATABASE ${quote(databaseName)}`)
    } catch {
      cleanupFailed = true
    }
  }
  if (admin) {
    for (const role of rolesCreated.reverse()) {
      try {
        await admin.client.$executeRawUnsafe(`DROP ROLE ${quote(role)}`)
      } catch {
        cleanupFailed = true
      }
    }
  } else if (databaseCreated || rolesCreated.length > 0) cleanupFailed = true
  await admin?.onModuleDestroy().catch(() => undefined)
  await rm(temporary, { recursive: true, force: true })
  if (cleanupFailed) {
    console.error('I7 environment cleanup failed; inspect the dedicated validation service')
    process.exitCode = 1
  }
}
