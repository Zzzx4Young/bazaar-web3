import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { sandbox, connect, testUrl, shipping } from '../tests/helpers/database.mjs'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { grantRuntime } from './runtime-grants.mjs'
import { httpIngressEnvironment, cleanupHttpIngress } from './http-ingress-environment.mjs'
import { fixtureMediaAsset } from '../tests/helpers/media.mjs'
import { exampleCommitment } from './example-commitment.mjs'

const origin = 'http://localhost:3000'
const root = new URL('../../', import.meta.url).pathname
const project = `bazaar-http-${randomUUID().replaceAll('-', '')}`
const role = `http_ingress_${randomUUID().replaceAll('-', '')}`
const policy = Object.freeze({ rtoMs: 60_000, readyMs: 15_000, pollMs: 100, requestTimeoutMs: 3000 })
const children = []
const sourceFiles = ['infra/http/haproxy.cfg', 'infra/compose.http-validation.yaml',
  'backend/scripts/http-ingress-environment.mjs', 'backend/scripts/check-http-ingress-business.mjs',
  'backend/tests/helpers/media.mjs',
  'backend/scripts/example-commitment.mjs',
  ...['main', 'app', 'config', 'auth/auth.service', 'orders/order-commands', 'orders/order-idempotency',
    'database/database.service', 'health/health.controller'].map(name => `backend/dist/${name}.js`)]
const fingerprint = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async name =>
  [name, createHash('sha256').update(await readFile(root + name)).digest('hex')])))
const report = { timestamp: new Date().toISOString(), project, policy,
  scope: 'two real API processes, two HTTP proxy processes, isolated PostgreSQL schema; low-load functional test, no database HA, TLS, host-fault or capacity acceptance',
  passed: false, cleaned: false, observations: [] }
let db, admin, ingress, roleCreated = false, ingressStarted = false, stage = 'setup'
async function port() {
  const server = createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const value = server.address().port
  await new Promise(resolve => server.close(resolve))
  return value
}
async function post(port, path, payload = {}, actor, key) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(actor ?? {}),
        ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(policy.requestTimeoutMs) })
    let value
    try { value = await response.json() } catch { value = null }
    return { status: response.status, value, cookies: response.headers.getSetCookie() }
  } catch { return { status: 0 } }
}
async function until(check) {
  const started = performance.now()
  do {
    if (await check()) return performance.now() - started
    await new Promise(resolve => setTimeout(resolve, policy.pollMs))
  } while (performance.now() - started < policy.readyMs)
  throw new Error('Readiness deadline exceeded')
}
async function startApi(url) {
  const apiPort = await port()
  const child = spawn(process.execPath, ['dist/main.js'], { cwd: root + 'backend',
    env: { ...process.env, DATABASE_URL: url.toString(), DATABASE_URL_FILE: '',
      APP_ORIGIN: origin, HOST: '127.0.0.1', PORT: String(apiPort), TRUSTED_PROXY_CIDRS: '127.0.0.1/32' },
    stdio: 'ignore' })
  children.push(child)
  await until(async () => {
    assert.equal(child.exitCode, null)
    assert.equal(child.signalCode, null)
    return (await post(apiPort, '/health/ready')).status === 200
  })
  return { port: apiPort, pid: child.pid }
}
const actor = response => ({ cookie: response.cookies[0].split(';')[0],
  'x-csrf-token': response.value.csrfToken })
async function discardOrderResponse(ingressPort, payload, actor, key) {
  // Drop the response at the client deliberately. Never consume or use its order ID.
  await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: ingressPort, path: '/api/orders', method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...actor, 'idempotency-key': key } }, res => {
      try { assert.equal(res.statusCode, 200) } catch (error) { reject(error); res.destroy(); return }
      res.destroy(); resolve()
    })
    req.on('error', reject)
    req.setTimeout(policy.requestTimeoutMs, () => req.destroy(new Error('Response timeout')))
    req.end(JSON.stringify(payload))
  })
}

async function businessRows(ids) {
  return db.client.order.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' },
    include: { snapshot: true, shipping: true,
      eventOrderRows: { orderBy: { id: 'asc' } },
      reservationOrderRows: { orderBy: { id: 'asc' } },
      idempotencyOrderRows: { orderBy: [{ actorId: 'asc' }, { operation: 'asc' }, { key: 'asc' }] },
      inventoryOrderRows: { orderBy: { listingId: 'asc' } } } })
}

try {
  report.sourceHashes = await fingerprint()
  db = await sandbox()
  admin = await connect(testUrl())
  const password = randomUUID(), runtimePassword = randomUUID()
  await provisionAccounts(db.client, ['seller', 'buyer', 'outsider'].map(loginName =>
    ({ loginName, displayName: loginName, password })))
  await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`)
  roleCreated = true
  await grantRuntime(db.client, db.schema, role)
  const url = new URL(db.url)
  url.username = role; url.password = runtimePassword
  stage = 'API startup'
  const apis = [await startApi(url), await startApi(url)]
  assert.notEqual(apis[0].pid, apis[1].pid)
  report.apiProcesses = apis
  const ports = [await port(), await port()]
  ingress = await httpIngressEnvironment({ project, origin, apiPorts: apis.map(api => api.port), ingressPorts: ports })
  ingressStarted = true
  await ingress.compose('up', '-d')
  for (const endpoint of ports) await until(async () => (await post(endpoint, '/health/ready')).status === 200)
  report.ingressEndpoints = ports.map(endpoint => `127.0.0.1:${endpoint}`)
  stage = 'real authentication'
  const actors = {}
  let sellerAccountId
  for (const loginName of ['seller', 'buyer', 'outsider']) {
    const login = await post(ports[0], '/auth/login', { loginName, password })
    assert.equal(login.status, 200)
    actors[loginName] = actor(login)
    if (loginName === 'seller') sellerAccountId = login.value.account.id
  }
  assert.ok(sellerAccountId)
  const priorBuyer = actors.buyer
  const rotated = await post(ports[1], '/auth/login', { loginName: 'buyer', password }, priorBuyer)
  assert.equal(rotated.status, 200)
  actors.buyer = actor(rotated)
  for (const endpoint of ports) {
    assert.equal((await post(endpoint, '/auth/session', {}, priorBuyer)).status, 401)
    assert.equal((await post(endpoint, '/auth/session', {}, actors.buyer)).status, 200)
    assert.equal((await post(endpoint, '/auth/session', {}, actors.outsider)).status, 200)
  }
  report.observations.push({ check: 'real-password-rotation-across-both-ingresses', oldSessionStatus: 401, newSessionStatus: 200 })
  const ids = []
  async function createListing(index) {
    // Ingress recovery is under test here; a ready media fixture isolates it from Garage.
    const media = await fixtureMediaAsset(db, sellerAccountId)
    const result = await post(ports[index % 2], '/listings', { type: 'physical', saleMode: 'one_off',
      category: 'electronics', title: `Ingress functional product ${index}`, description: 'Isolated real database product',
      price: { amount: '12.50', currency: 'USD' }, mediaIds: [media.id],
      commitment: exampleCommitment('physical') }, actors.seller)
    assert.equal(result.status, 201)
    return { listingId: result.value.id, version: 1, shipping }
  }
  stage = 'baseline original-key replay'
  const baselinePayload = await createListing(0), baselineKey = randomUUID()
  const baseline = await post(ports[0], '/orders', baselinePayload, actors.buyer, baselineKey)
  assert.equal(baseline.status, 200)
  ids.push(baseline.value.orderId)
  const replay = await post(ports[1], '/orders', baselinePayload, actors.buyer, baselineKey)
  assert.equal(replay.status, 200)
  assert.equal(replay.value.orderId, ids[0])
  for (let index = 0; index < 2; index++) {
    stage = `lost-response and ingress${index + 1} kill`
    const payload = await createListing(index + 1), key = randomUUID()
    await discardOrderResponse(ports[index], payload, actors.buyer, key)
    const committed = await db.client.order.findFirstOrThrow({ where: { listingId: payload.listingId } })
    const acknowledgedRows = await businessRows([...ids, committed.id])
    const started = performance.now()
    await ingress.compose('kill', '-s', 'SIGKILL', `ingress${index + 1}`)
    assert.equal((await post(ports[index], '/health/ready')).status, 0)
    const recovered = await post(ports[1 - index], '/orders', payload, actors.buyer, key)
    assert.equal(recovered.status, 200)
    assert.equal(recovered.value.orderId, committed.id)
    const recoveryMs = performance.now() - started
    assert.ok(recoveryMs <= policy.rtoMs)
    ids.push(recovered.value.orderId)
    assert.equal((await post(ports[1 - index], `/orders/${committed.id}`, {}, actors.outsider)).status, 404)
    await ingress.compose('up', '-d', `ingress${index + 1}`)
    await until(async () => (await post(ports[index], '/health/ready')).status === 200)
    const restored = await post(ports[index], '/orders', payload, actors.buyer, key)
    assert.equal(restored.status, 200)
    assert.equal(restored.value.orderId, committed.id)
    assert.deepEqual(await businessRows(ids), acknowledgedRows,
      'Proxy fault and original-key recovery changed committed business records')
    for (const api of apis) assert.equal((await post(api.port, '/health/ready')).status, 200)
    report.observations.push({ check: 'client-discarded-response-then-real-proxy-kill-original-key-recovery', index, recoveryMs })
  }
  stage = 'database business audit'
  assert.equal(new Set(ids).size, 3)
  assert.equal(await db.client.order.count(), 3)
  assert.equal(await db.client.orderEvent.count({ where: { operation: 'create' } }), 3)
  assert.equal(await db.client.inventoryReservation.count(), 3)
  assert.equal(await db.client.idempotencyRecord.count(), 3)
  for (const id of ids) {
    const order = await db.client.order.findUniqueOrThrow({ where: { id } })
    assert.equal(order.status, 'pending_payment')
    const inventory = await db.client.physicalInventory.findUniqueOrThrow({ where: { listingId: order.listingId } })
    assert.equal(inventory.activeOrderId, id)
    assert.equal(inventory.availability, 'reserved')
  }
  assert.equal(await db.client.session.count(), 4)
  assert.equal(await db.client.session.count({ where: { revokedAt: { not: null } } }), 1)
  report.databaseAudit = { orders: 3, createEvents: 3, reservations: 3, idempotencyRecords: 3,
    inventoryMatches: true, fullCommittedRecordsUnchanged: true, sessions: 4, revokedSessions: 1 }
  assert.deepEqual(await fingerprint(), report.sourceHashes)
  report.passed = true
} catch (error) {
  report.failure = { stage, name: error.name, code: error.code ?? 'CHECK_FAILED' }
  process.exitCode = 1
} finally {
  let cleanupFailed = false
  if (ingressStarted) cleanupFailed = !(await cleanupHttpIngress(ingress))
  else await ingress?.dispose()
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(timer)
    }
  }
  try {
    await db?.close()
    if (roleCreated) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin?.onModuleDestroy()
  } catch { cleanupFailed = true }
  report.cleaned = !cleanupFailed
  if (cleanupFailed) { report.passed = false; process.exitCode = 1 }
  await mkdir(root + 'backend/.tmp', { recursive: true })
  await writeFile(root + 'backend/.tmp/http-ingress-business-report.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(report))
}
