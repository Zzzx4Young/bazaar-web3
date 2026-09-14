import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../dist/database/database.service.js'

const adminUrl = new URL(process.env.TEST_DATABASE_URL ?? '')
if (adminUrl.pathname !== '/bazaar_test' || adminUrl.hostname !== '127.0.0.1') {
  throw new Error('TEST_DATABASE_URL must explicitly target loopback bazaar_test')
}
adminUrl.searchParams.set('schema', 'public')

const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
const schema = `deploy_${suffix}`
const migrateRole = `deploy_m_${suffix}`
const runtimeRole = `deploy_r_${suffix}`
const containerName = `bazaar_api_${suffix}`
const migratePassword = randomBytes(24).toString('hex')
const runtimePassword = randomBytes(24).toString('hex')
const runtimeImage = process.env.RUNTIME_IMAGE ?? 'bazaar-api:ci'
const migrateImage = process.env.MIGRATE_IMAGE ?? 'bazaar-api-migrate:ci'
const docker = process.env.DOCKER_USE_SUDO === '1' ? ['sudo', '-n', 'docker'] : ['docker']
const secretDirectory = mkdtempSync(join(tmpdir(), 'bazaar-deployment-'))
const migrateSecret = join(secretDirectory, 'migration_database_url')
const runtimeSecret = join(secretDirectory, 'runtime_database_url')

function redact(output, urls = []) {
  let safe = output
  for (const url of urls) {
    safe = safe.replaceAll(url.toString(), '[DATABASE_URL]')
    if (url.password) safe = safe.replaceAll(decodeURIComponent(url.password), '[REDACTED]')
  }
  return safe
}

async function command(args, options = {}) {
  const child = spawn(docker[0], [...docker.slice(1), ...args], {
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${docker.join(' ')} ${args[0]} failed: ${redact(output, options.urls)}`)
  }
  return { code, output }
}

function roleUrl(role, password) {
  const url = new URL(adminUrl)
  url.username = role
  url.password = password
  url.searchParams.set('schema', schema)
  return url
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

const admin = new DatabaseService(adminUrl.toString())
let runtime
try {
  await admin.onModuleInit()
  await admin.client.$executeRawUnsafe(
    `CREATE ROLE "${migrateRole}" LOGIN PASSWORD '${migratePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
  )
  await admin.client.$executeRawUnsafe(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
  )
  await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}" AUTHORIZATION "${migrateRole}"`)
  await admin.client.$executeRawUnsafe(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`)

  const migrateUrl = roleUrl(migrateRole, migratePassword)
  const runtimeUrl = roleUrl(runtimeRole, runtimePassword)
  writeFileSync(migrateSecret, `${migrateUrl}\n`, { mode: 0o444 })
  writeFileSync(runtimeSecret, `${runtimeUrl}\n`, { mode: 0o444 })
  await command(
    [
      'run',
      '--rm',
      '--network',
      'host',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--mount',
      `type=bind,src=${migrateSecret},dst=/run/secrets/migration_database_url,readonly`,
      '-e',
      'DATABASE_URL_FILE=/run/secrets/migration_database_url',
      '-e',
      `DATABASE_RUNTIME_ROLE=${runtimeRole}`,
      migrateImage
    ],
    { urls: [migrateUrl, runtimeUrl] }
  )

  const migrations = await admin.client.$queryRawUnsafe(
    `SELECT count(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  )
  assert.equal(migrations[0].count, 6)

  runtime = new DatabaseService(runtimeUrl.toString())
  await runtime.onModuleInit()
  await assert.rejects(
    runtime.client.$executeRawUnsafe(`CREATE TABLE "${schema}"."forbidden" (id int)`)
  )

  const port = await availablePort()
  await command([
    'run',
    '--detach',
    '--name',
    containerName,
    '--network',
    'host',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--mount',
    `type=bind,src=${runtimeSecret},dst=/run/secrets/runtime_database_url,readonly`,
    '-e',
    'DATABASE_URL_FILE=/run/secrets/runtime_database_url',
    '-e',
    'APP_ORIGIN=http://localhost:3000',
    '-e',
    'HOST=127.0.0.1',
    '-e',
    `PORT=${port}`,
    runtimeImage
  ])

  let ready = false
  const deadline = Date.now() + 15000
  while (!ready && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(500)
      })
      ready = response.status === 200
    } catch {
      /* The process may still be initializing its database connection. */
    }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) {
    const state = await command([
      'inspect',
      containerName,
      '--format',
      '{{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}'
    ])
    const logs = await command(['logs', containerName])
    throw new Error(
      `Runtime image did not become ready: ${state.output.trim()} ${redact(logs.output, [runtimeUrl])}`
    )
  }

  const inspection = await command(['inspect', containerName, '--format', '{{.Config.User}}'])
  assert.equal(inspection.output.trim(), 'node')
  const prismaCli = await command(
    ['run', '--rm', '--entrypoint', 'node', runtimeImage, '-e', "import('node:fs').then(fs=>process.exit(fs.existsSync('/app/node_modules/prisma')?1:0))"],
    { allowFailure: true }
  )
  assert.equal(prismaCli.code, 0, 'Runtime image contains the Prisma migration CLI')
  console.log('I8-2 PASS: migration and runtime images, 6 migrations, grants, readiness and hardening verified')
} finally {
  await command(['stop', '--time', '5', containerName], { allowFailure: true })
  await command(['rm', '--force', containerName], { allowFailure: true })
  await runtime?.onModuleDestroy()
  try {
    await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`)
    await admin.client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${migrateRole}"`)
  } finally {
    await admin.onModuleDestroy()
    rmSync(secretDirectory, { recursive: true, force: true })
  }
}
