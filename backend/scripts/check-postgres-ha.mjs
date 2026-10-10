import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { DatabaseService } from '../dist/database/database.service.js'
import { OrderCommands } from '../dist/orders/order-commands.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { grantRuntime } from './runtime-grants.mjs'
import { cli } from '../tests/helpers/database.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const project = `bazaar-ha-${randomUUID().replaceAll('-', '')}`
const composeFile = 'infra/compose.ha-validation.yaml'
const runtimeRole = 'bazaar_ha_runtime'
const origin = 'http://localhost:3000'
const schema = 'bazaar_ha'
let secretsDirectory, env, primary, standby, app, promotedApp, stage = 'prepare', cleanupSucceeded = false

async function compose(...args) {
  const child = spawn('sudo', ['-n', 'env', `HA_ADMIN_PASSWORD_FILE=${env.HA_ADMIN_PASSWORD_FILE}`,
    `HA_REPLICATION_PASSWORD_FILE=${env.HA_REPLICATION_PASSWORD_FILE}`,
    'docker', 'compose', '-f', composeFile, '-p', project, ...args],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.resume()
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject); child.on('exit', resolve)
    })
    if (code !== 0) throw new Error('HA Compose action failed')
    return output.trim()
  } finally { clearTimeout(timer) }
}

async function connection(service, password) {
  const mapped = await compose('port', service, '5432')
  assert.match(mapped, /^127\.0\.0\.1:\d+$/)
  const url = new URL(`postgresql://bazaar_ha_admin@${mapped}/bazaar_ha_validation`)
  url.password = password
  url.searchParams.set('schema', schema)
  const database = new DatabaseService(url.toString())
  await database.onModuleInit()
  return { database, url }
}

async function until(check, message, timeout = 30000) {
  const end = performance.now() + timeout
  while (performance.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}

async function counts(client) {
  return { orders: await client.order.count(), snapshots: await client.orderSnapshot.count(),
    reservations: await client.inventoryReservation.count({ where: { state: 'active' } }),
    reservedStock: await client.physicalInventory.count({ where: { availability: 'reserved' } }),
    sessions: await client.session.count(), events: await client.orderEvent.count() }
}

try {
  await mkdir(new URL('../.tmp/', import.meta.url), { recursive: true })
  secretsDirectory = await mkdtemp(fileURLToPath(new URL('../.tmp/ha-', import.meta.url)))
  const adminPassword = randomBytes(32).toString('hex')
  const replicationPassword = randomBytes(32).toString('hex')
  const runtimePassword = randomBytes(32).toString('hex')
  const adminFile = `${secretsDirectory}/admin-password`
  const replicationFile = `${secretsDirectory}/replication-password`
  await writeFile(adminFile, adminPassword, { mode: 0o600 })
  await writeFile(replicationFile, replicationPassword, { mode: 0o600 })
  env = { ...process.env, HA_ADMIN_PASSWORD_FILE: adminFile, HA_REPLICATION_PASSWORD_FILE: replicationFile }
  stage = 'primary bootstrap'
  await compose('up', '-d', '--wait', '--wait-timeout', '90', 'primary')
  const primaryConnection = await connection('primary', adminPassword)
  primary = primaryConnection.database
  await primary.client.$executeRawUnsafe(`CREATE ROLE bazaar_ha_replica LOGIN REPLICATION PASSWORD '${replicationPassword}'`)
  await primary.client.$executeRawUnsafe(`CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`)
  await cli(['migrate', 'deploy'], primaryConnection.url)
  await grantRuntime(primary.client, schema, runtimeRole)
  stage = 'standby base backup'
  await compose('up', '-d', '--wait', '--wait-timeout', '90', 'standby')
  const standbyConnection = await connection('standby', adminPassword)
  standby = standbyConnection.database
  assert.equal((await standby.client.$queryRaw`SELECT pg_is_in_recovery() AS recovery`)[0].recovery, true)
  await assert.rejects(standby.client.$executeRawUnsafe('CREATE TABLE ha_readonly_probe (id integer)'))
  await until(async () => {
    const rows = await primary.client.$queryRaw`SELECT state FROM pg_stat_replication WHERE application_name = 'bazaar_ha_standby'`
    return rows.length === 1 && rows[0].state === 'streaming'
  }, 'Standby did not enter streaming replication')
  await primary.client.$executeRawUnsafe("ALTER SYSTEM SET synchronous_standby_names = 'FIRST 1 (bazaar_ha_standby)'")
  await primary.client.$executeRawUnsafe("ALTER SYSTEM SET synchronous_commit = 'remote_apply'")
  await primary.client.$queryRaw`SELECT pg_reload_conf()`
  await until(async () => {
    const rows = await primary.client.$queryRaw`SELECT sync_state FROM pg_stat_replication WHERE application_name = 'bazaar_ha_standby'`
    return rows[0]?.sync_state === 'sync'
  }, 'Standby did not become synchronous')
  stage = 'synchronous business writes'
  const settings = (await primary.client.$queryRaw`SELECT current_setting('synchronous_commit') AS commit`)[0]
  assert.equal(settings.commit, 'remote_apply')
  const password = `HA-${randomUUID()}`
  await provisionAccounts(primary.client, [
    { loginName: 'ha-seller', displayName: 'HA seller', password },
    { loginName: 'ha-buyer', displayName: 'HA buyer', password }
  ])
  const seller = await primary.client.account.findUniqueOrThrow({ where: { loginName: 'ha-seller' } })
  const buyer = await primary.client.account.findUniqueOrThrow({ where: { loginName: 'ha-buyer' } })
  const listings = Array.from({ length: 50 }, (_, index) => ({ id: randomUUID(), sellerId: seller.id,
    type: 'physical', category: 'electronics', title: `HA item ${index}`, description: 'Isolated replication fixture',
    priceAmount: '10.00', currency: 'USD' }))
  await primary.client.listing.createMany({ data: listings })
  await primary.client.physicalInventory.createMany({ data: listings.map(({ id }) => ({ listingId: id })) })
  const runtimeUrl = new URL(primaryConnection.url)
  runtimeUrl.username = runtimeRole; runtimeUrl.password = runtimePassword
  app = await createApp(readConfig({ DATABASE_URL: runtimeUrl.toString() }), false)
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin },
    payload: { loginName: 'ha-buyer', password } })
  assert.equal(login.statusCode, 200)
  const cookie = login.headers['set-cookie'].split(';')[0]
  const orders = new OrderCommands(app.get(DatabaseService).client)
  const orderIds = []
  for (const listing of listings) orderIds.push(await orders.create(buyer.id, randomUUID(), {
    listingId: listing.id, version: 1, shipping: { recipient: 'HA test', contact: 'virtual', address: 'Isolated address' }
  }))
  const before = await counts(primary.client)
  assert.equal(before.orders, 50)
  assert.equal(before.snapshots, 50)
  assert.equal(before.reservations, 50)
  assert.equal(before.reservedStock, 50)
  assert.equal(before.sessions, 1)
  // remote_apply acknowledges only after the standby applies each transaction.
  assert.deepEqual(await counts(standby.client), before)
  console.log('HA synchronous replication verified: 50 orders, reservations and snapshots')
  stage = 'fence primary and promote standby'
  const failoverStarted = performance.now()
  await compose('kill', '-s', 'SIGKILL', 'primary')
  const running = JSON.parse(await compose('ps', '--all', '--format', 'json', 'primary'))
  assert.equal(running.State, 'exited')
  const unavailable = await app.inject({ method: 'POST', url: '/api/health/ready', headers: { origin, 'content-type': 'application/json' }, payload: {} })
  assert.equal(unavailable.statusCode, 503)
  await standby.client.$queryRaw`SELECT pg_promote(true, 30)`
  assert.equal((await standby.client.$queryRaw`SELECT pg_is_in_recovery() AS recovery`)[0].recovery, false)
  const afterPromotion = await counts(standby.client)
  assert.deepEqual(afterPromotion, before)
  const newRuntimeUrl = new URL(runtimeUrl); newRuntimeUrl.port = standbyConnection.url.port
  promotedApp = await createApp(readConfig({ DATABASE_URL: newRuntimeUrl.toString() }), false)
  const session = await promotedApp.inject({ method: 'POST', url: '/api/auth/session',
    headers: { origin, cookie, 'content-type': 'application/json' }, payload: {} })
  assert.equal(session.statusCode, 200)
  assert.equal(session.json().account.id, buyer.id)
  const cancel = await promotedApp.inject({ method: 'POST', url: `/api/orders/${orderIds[0]}/actions/cancel`,
    headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': login.json().csrfToken,
      'idempotency-key': randomUUID() }, payload: {} })
  assert.equal(cancel.statusCode, 200)
  assert.equal((await standby.client.order.findUniqueOrThrow({ where: { id: orderIds[0] } })).status, 'cancelled')
  assert.equal((await standby.client.physicalInventory.findUniqueOrThrow({ where: { listingId: listings[0].id } })).availability, 'available')
  const report = { timestamp: new Date().toISOString(), postgresMajor: 17,
    mode: 'remote_apply, fenced manual promotion, explicit application endpoint replacement',
    acknowledgedOrders: orderIds.length, lostAcknowledgedOrders: before.orders - afterPromotion.orders, before, afterPromotion,
    originalSessionVerified: true, postPromotionCancelVerified: true,
    failoverToVerifiedWriteMs: performance.now() - failoverStarted,
    limitations: ['same-host containers', 'no automatic election or stable writer endpoint',
      'old primary not rejoined; promoted node temporarily has no standby', 'no production RPO/RTO promise'] }
  await writeFile(new URL('../.tmp/postgres-ha-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ event: 'postgres_ha_result', report }))
} catch {
  console.error(`PostgreSQL HA check failed at stage: ${stage}`)
  process.exitCode = 1
} finally {
  await promotedApp?.close()
  await app?.close()
  await standby?.onModuleDestroy()
  await primary?.onModuleDestroy()
  if (env) {
    try {
      await compose('down', '--volumes', '--remove-orphans')
      cleanupSucceeded = true
    } catch { console.error(`HA cleanup failed; isolated project retained: ${project}`); process.exitCode = 1 }
  }
  if (cleanupSucceeded && secretsDirectory) await rm(secretsDirectory, { recursive: true, force: true })
}
