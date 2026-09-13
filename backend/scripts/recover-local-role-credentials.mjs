import { randomBytes } from 'node:crypto'
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseService } from '../dist/database/database.service.js'
import {
  assertRestrictedRoles,
  migrationRole,
  runtimeRole,
  schema,
  validateRecoveryTarget
} from './local-role-credential-recovery.mjs'

const outputDirectory = resolve('.tmp')
const migrationFile = resolve(outputDirectory, 'i7-migrate.env')
const runtimeFile = resolve('.env')
const createdFiles = []
let db

const password = () => randomBytes(48).toString('base64url')
const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`
const connectionFor = (source, role, secret) => {
  const url = new URL(source)
  url.username = role
  url.password = secret
  url.searchParams.set('schema', schema)
  return url.toString()
}

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--confirm-local-rotation')
    throw new Error('Explicit confirmation flag required')
  const source = validateRecoveryTarget(process.env.ADMIN_DATABASE_URL)

  db = new DatabaseService(source.toString())
  await db.onModuleInit()
  const roles = await db.client.$queryRaw`
    SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_roles
    WHERE rolname IN (${migrationRole}, ${runtimeRole})
    ORDER BY rolname
  `
  const memberships = await db.client.$queryRaw`
    SELECT member.rolname AS member_role, granted.rolname AS granted_role
    FROM pg_roles member
    CROSS JOIN pg_roles granted
    WHERE member.rolname IN (${migrationRole}, ${runtimeRole})
      AND member.oid <> granted.oid
      AND pg_has_role(member.oid, granted.oid, 'MEMBER')
  `
  const owners = await db.client.$queryRaw`
    SELECT owner.rolname
    FROM pg_namespace namespace
    JOIN pg_roles owner ON owner.oid = namespace.nspowner
    WHERE namespace.nspname = ${schema}
  `
  assertRestrictedRoles(roles, memberships, owners)

  const migrationPassword = password()
  const runtimePassword = password()
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  await chmod(outputDirectory, 0o700)
  await writeFile(
    migrationFile,
    `DATABASE_URL=${connectionFor(source, migrationRole, migrationPassword)}\n`,
    { mode: 0o600, flag: 'wx' }
  )
  createdFiles.push(migrationFile)
  await writeFile(
    runtimeFile,
    [
      `DATABASE_URL=${connectionFor(source, runtimeRole, runtimePassword)}`,
      'HOST=127.0.0.1',
      'PORT=3001',
      'APP_ORIGIN=http://localhost:3000',
      ''
    ].join('\n'),
    { mode: 0o600, flag: 'wx' }
  )
  createdFiles.push(runtimeFile)

  await db.client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `ALTER ROLE "${migrationRole}" PASSWORD ${sqlLiteral(migrationPassword)}`
    )
    await transaction.$executeRawUnsafe(
      `ALTER ROLE "${runtimeRole}" PASSWORD ${sqlLiteral(runtimePassword)}`
    )
  })
  console.log('Local role credentials rotated; private migration and runtime env files created')
} catch {
  for (const file of createdFiles) await unlink(file).catch(() => undefined)
  console.error(
    'Local role credential recovery failed; verify the admin URL, restricted roles, schema ownership and absent output files'
  )
  process.exitCode = 1
} finally {
  await db?.onModuleDestroy()
}
