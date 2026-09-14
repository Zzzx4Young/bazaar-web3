import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseService } from '../dist/database/database.service.js'
import { grantRuntime } from './runtime-grants.mjs'

function databaseUrl() {
  const direct = process.env.DATABASE_URL
  const file = process.env.DATABASE_URL_FILE
  if ((direct && file) || (!direct && !file)) {
    throw new Error('Set exactly one of DATABASE_URL or DATABASE_URL_FILE')
  }
  if (direct) return direct
  try {
    const value = readFileSync(file, 'utf8').replace(/\r?\n$/, '')
    if (!value || /[\r\n]/.test(value)) throw new Error()
    return value
  } catch {
    throw new Error('DATABASE_URL_FILE must contain one database URL')
  }
}

function identifier(value, name) {
  if (!value || !/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`)
  }
  return value
}

async function main() {
  const url = databaseUrl()
  const parsed = new URL(url)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('Database secret must contain a PostgreSQL URL')
  }
  const schema = identifier(parsed.searchParams.get('schema') ?? 'public', 'Database schema')
  const runtimeRole = identifier(process.env.DATABASE_RUNTIME_ROLE, 'DATABASE_RUNTIME_ROLE')
  const env = { ...process.env, DATABASE_URL: url }
  delete env.DATABASE_URL_FILE
  const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: 'inherit'
  })
  const [code, signal] = await once(child, 'exit')
  if (code !== 0) throw new Error(`Migration command failed (${signal ?? code})`)

  const database = new DatabaseService(url)
  try {
    await database.onModuleInit()
    await grantRuntime(database.client, schema, runtimeRole)
  } finally {
    await database.onModuleDestroy()
  }
  console.log('Migrations deployed and runtime grants refreshed')
}

main().catch(() => {
  console.error('Migration deployment failed; check configuration, ownership and database state')
  process.exitCode = 1
})
