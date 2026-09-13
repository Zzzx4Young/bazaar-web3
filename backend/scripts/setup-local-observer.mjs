import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseService } from '../dist/database/database.service.js'
import { grantObserver } from './observer-grants.mjs'

const role = 'bazaar_observer'
const sourceSchema = 'bazaar'
const observeSchema = 'bazaar_observe'
const outputFile = resolve('.tmp/i8-observer.env')
const literal = (value) => `'${value.replaceAll("'", "''")}'`
const envUrl = async (file) => {
  const content = await readFile(resolve(file), 'utf8')
  const line = content.split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='))
  if (!line) throw new Error(`DATABASE_URL missing from ${file}`)
  return new URL(line.slice('DATABASE_URL='.length))
}
const assertLocal = (url, user) => {
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/bazaar_dev' ||
    decodeURIComponent(url.username) !== user
  )
    throw new Error('Refusing unexpected local database target')
}

let admin, migration, observer
let roleCreated = false
let schemaCreated = false
let fileCreated = false
try {
  if (process.argv.length !== 3 || process.argv[2] !== '--confirm-local-create')
    throw new Error('Explicit confirmation flag required')
  const adminUrl = new URL('postgresql://bazaar_admin@127.0.0.1:5432/bazaar_dev?schema=bazaar')
  adminUrl.password = (
    await readFile(new URL('../../infra/.secrets/postgres_password', import.meta.url), 'utf8')
  ).trim()
  const migrationUrl = await envUrl('.tmp/i7-migrate.env')
  assertLocal(adminUrl, 'bazaar_admin')
  assertLocal(migrationUrl, 'bazaar_migrate')
  await readFile(outputFile).then(
    () => {
      throw new Error('Observer env already exists')
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error
    }
  )

  admin = new DatabaseService(adminUrl.toString())
  await admin.onModuleInit()
  const existing = await admin.client.$queryRaw`
    SELECT
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS role_exists,
      EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${observeSchema}) AS schema_exists`
  if (existing.length !== 1 || existing[0].role_exists || existing[0].schema_exists)
    throw new Error('Observer role or schema already exists')

  const password = randomBytes(48).toString('base64url')
  await admin.client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)}`
    )
    roleCreated = true
    await tx.$executeRawUnsafe(`ALTER ROLE "${role}" SET default_transaction_read_only = on`)
    await tx.$executeRawUnsafe(`ALTER ROLE "${role}" SET statement_timeout = '3s'`)
    await tx.$executeRawUnsafe(`ALTER ROLE "${role}" SET idle_in_transaction_session_timeout = '3s'`)
    await tx.$executeRawUnsafe(
      `ALTER ROLE "${role}" SET search_path = "${observeSchema}", pg_catalog`
    )
    await tx.$executeRawUnsafe(
      `CREATE SCHEMA "${observeSchema}" AUTHORIZATION "bazaar_migrate"`
    )
    schemaCreated = true
    await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA "${observeSchema}" FROM PUBLIC`)
  })

  migration = new DatabaseService(migrationUrl.toString())
  await migration.onModuleInit()
  await grantObserver(migration.client, sourceSchema, observeSchema, role)
  const observerUrl = new URL(adminUrl)
  observerUrl.username = role
  observerUrl.password = password
  observerUrl.searchParams.set('schema', observeSchema)
  observer = new DatabaseService(observerUrl.toString())
  await observer.onModuleInit()
  const proof = await observer.client.$queryRawUnsafe(
    `SELECT current_setting('default_transaction_read_only') AS read_only,
      (SELECT count(*)::int FROM information_schema.views
       WHERE table_schema = '${observeSchema}') AS views`
  )
  if (proof.length !== 1 || proof[0].read_only !== 'on' || proof[0].views !== 16)
    throw new Error('Observer verification failed')

  await mkdir(resolve('.tmp'), { recursive: true, mode: 0o700 })
  await chmod(resolve('.tmp'), 0o700)
  await writeFile(outputFile, `DATABASE_URL=${observerUrl.toString()}\n`, {
    mode: 0o600,
    flag: 'wx'
  })
  fileCreated = true
  console.log('Local observer created and verified with 16 curated read-only views')
} catch {
  if (fileCreated) await unlink(outputFile).catch(() => undefined)
  await observer?.onModuleDestroy()
  observer = undefined
  await migration?.onModuleDestroy()
  migration = undefined
  if (schemaCreated)
    await admin?.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${observeSchema}" CASCADE`)
  if (roleCreated) await admin?.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`)
  console.error(
    'Local observer setup failed; verify build output, local admin/migration credentials and absent observer objects'
  )
  process.exitCode = 1
} finally {
  await observer?.onModuleDestroy()
  await migration?.onModuleDestroy()
  await admin?.onModuleDestroy()
}
