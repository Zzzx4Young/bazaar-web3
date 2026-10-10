import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createServer, request, Agent } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { availableParallelism, totalmem, platform, arch } from 'node:os'
import { performance } from 'node:perf_hooks'
import { once } from 'node:events'
import { setInterval, clearInterval } from 'node:timers'
import { sandbox } from '../tests/helpers/database.mjs'
import { grantRuntime } from './runtime-grants.mjs'
import { capacityDatabaseUrls } from './capacity-database-ingress.mjs'
import { monotonicNow } from './capacity-monotonic.mjs'
import { capacityGatewayProbes } from './capacity-gateway-probes.mjs'
import { capacityGateway } from './capacity-gateway.mjs'
import { capacityResources } from './capacity-resources.mjs'
import { sessionMaxAgeSeconds } from '../dist/auth/auth-policy.js'
import { capacityWrites, capacityWritePolicy } from './capacity-writes.mjs'
import { capacityApiFaultPolicy, capacityBusinessMixPolicy, readCapacityPolicy } from './capacity-policy.mjs'
import { capacityAuth } from './capacity-auth.mjs'
import { capacityAuthPolicy } from './capacity-auth-policy.mjs'
import { capacityOutageWrites } from './capacity-outage-writes.mjs'
import { capacityDatabaseFault, capacityDatabaseFaultPolicy } from './capacity-database-fault.mjs'
import { verifyCapacityReplication } from './capacity-replication.mjs'

// This command accepts only the explicit ephemeral test DB via sandbox/testUrl.
const policy = readCapacityPolicy(process.env)
const origin = 'http://localhost:3000'
const agent = new Agent({ keepAlive: true, maxSockets: policy.users })
const processes = []
const faultMode = process.env.CAPACITY_FAULT === '1'
const writeMode = process.env.CAPACITY_WRITES === '1'
const profilingEnabled = process.env.CAPACITY_PROFILE === '1'
const databaseFaultMode = policy.databaseFault !== 'none'
const gatewayFaultMode = policy.databaseFault === 'gateway-kill'
const authMode = process.env.CAPACITY_AUTH === '1'
assert.ok(!authMode || (writeMode && !databaseFaultMode), 'Authentication profile requires business writes and no simultaneous database fault')
const databaseFault = databaseFaultMode ? capacityDatabaseFault(policy.databaseFault) : undefined
assert.ok(
  !databaseFaultMode || (writeMode && !faultMode && process.send),
  'Database fault requires HA wrapper IPC, write load, and no simultaneous API fault'
)
let faultRequested = false
let faultControlFinished = false
if (databaseFaultMode)
  process.on('message', (message) => {
    if (message?.event === 'database-fault-failed') {
      databaseFault.report.controllerFailed = true
      faultControlFinished = true
    } else if (message?.event?.startsWith('database-')) {
      databaseFault.update(message)
      if (message.event === 'database-gateway-kill-starting') process.send({ event: 'database-gateway-kill-ready' })
      if (message.event === 'database-fault-complete') faultControlFinished = true
    }
  })
const healthTransitions = []
let db,
  gateway,
  gatewayProbes,
  authLoad,
  stopResources,
  healthTimer,
  roleCreated = false
let stage = 'test schema initialization'
const privateValues = [process.env.TEST_DATABASE_URL].filter(Boolean)
if (process.env.TEST_DATABASE_URL)
  privateValues.push(decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).password))
const role = `capacity_${randomUUID().replaceAll('-', '')}`
const digest = (value) => createHash('sha256').update(value).digest('hex')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function post(port, path, payload = {}, user, key) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent,
        headers: {
          origin,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(user
            ? {
                cookie: `bazaar_session=${user.token}`,
                'x-csrf-token': digest(`csrf:${user.token}`)
              }
            : {}),
          ...(key ? { 'idempotency-key': key } : {}),
          ...(user?.virtualClientId ? { 'x-capacity-client': user.virtualClientId } : {})
        }
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('error', reject)
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, value: JSON.parse(data), setCookie: res.headers['set-cookie'],
              apiIndex: res.headers['x-capacity-api-index'] === undefined ? undefined : Number(res.headers['x-capacity-api-index']) })
          } catch {
            reject(new Error('Invalid JSON response'))
          }
        })
      }
    )
    req.setTimeout(policy.timeoutMs, () => {
      const error = new Error('Request timeout')
      error.code = 'ETIMEDOUT'
      req.destroy(error)
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function startApi(url) {
  // Reserve a free port without replacing any existing development service.
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const preload = profilingEnabled ? ['--import', './scripts/capacity-profile.mjs'] : []
  const api = spawn(process.execPath, [...preload, 'dist/main.js'], {
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      DATABASE_URL_FILE: '',
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_ORIGIN: origin,
      DB_POOL_MAX: String(policy.poolMax),
      API_MAX_IN_FLIGHT: String(policy.maxInFlightRequests),
      TRUSTED_PROXY_CIDRS: authMode ? capacityAuthPolicy.trustedProxyCidr : ''
    },
    stdio: profilingEnabled ? ['ignore', 'ignore', 'ignore', 'ipc'] : ['ignore', 'ignore', 'ignore']
  })
  processes.push(api)
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null || api.signalCode !== null)
      throw new Error('API process exited before readiness')
    try {
      if ((await post(port, '/api/health/ready')).status === 200) {
        if (profilingEnabled) api.send({ command: 'start-capacity-profile' })
        return { port, pid: api.pid, healthy: true }
      }
    } catch {
      /* Connection refusal is expected until the process starts listening. */
    }
    await sleep(100)
  }
  throw new Error('API readiness timed out')
}

const quantile = (values, fraction) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(values.length - 1, Math.floor(values.length * fraction))
  return Number(sorted[index].toFixed(2))
}

async function checkWriteCompetition(instances, users, listing) {
  const payload = {
    listingId: listing.id,
    version: 1,
    shipping: {
      recipient: 'Capacity race',
      contact: 'Isolated fixture',
      address: 'Race fixture address'
    }
  }
  const key = randomUUID()
  const replay = await Promise.all(
    instances.map((instance) => post(instance.port, '/api/orders', payload, users[0], key))
  )
  assert.ok(replay.every((response) => response.status === 200))
  assert.equal(replay[0].value.orderId, replay[1].value.orderId)
  assert.equal(
    (
      await post(
        instances[0].port,
        `/api/orders/${replay[0].value.orderId}/actions/cancel`,
        {},
        users[0],
        randomUUID()
      )
    ).status,
    200
  )
  const race = await Promise.all(
    instances.map((instance, index) =>
      post(instance.port, '/api/orders', payload, users[index], randomUUID())
    )
  )
  assert.deepEqual(race.map((response) => response.status).sort(), [200, 409])
  assert.equal(race.find((response) => response.status === 409).value.code, 'UNAVAILABLE')
  const winner = race.findIndex((response) => response.status === 200)
  assert.equal(
    (
      await post(
        instances[winner].port,
        `/api/orders/${race[winner].value.orderId}/actions/cancel`,
        {},
        users[winner],
        randomUUID()
      )
    ).status,
    200
  )
  const rows = await db.client.order.findMany({
    where: { listingId: listing.id },
    include: { eventOrderRows: true }
  })
  assert.equal(rows.length, 2)
  assert.ok(
    rows.every((order) => order.status === 'cancelled' && order.eventOrderRows.length === 2)
  )
  const item = await db.client.physicalInventory.findUniqueOrThrow({
    where: { listingId: listing.id }
  })
  assert.equal(item.availability, 'available')
  assert.equal(item.activeOrderId, null)
  assert.equal(
    await db.client.inventoryReservation.count({
      where: { listingId: listing.id, state: 'active' }
    }),
    0
  )
  return {
    sameKeyConcurrentReplay: true,
    singleReservationWinner: true,
    cancellationReleasedInventory: true
  }
}

async function load(port, users, listings, onTick, writes) {
  const latency = [],
    scheduledLatency = [],
    lag = [],
    errors = {},
    userRequests = new Map()
  const expectedErrors = {}
  const failureSamples = [],
    errorWindows = {}
  let sent = 0,
    completed = 0,
    active = 0,
    peakActive = 0,
    dropped = 0
  const started = performance.now()
  const planned = policy.rate * policy.seconds
  const promises = new Set()
  async function send(index, scheduled) {
    const user = users[index % users.length]
    userRequests.set(user.id, (userRequests.get(user.id) ?? 0) + 1)
    const kind = index % capacityBusinessMixPolicy.slots
    const authAction = authLoad?.schedule.at(index)
    const path =
      kind < 5
        ? '/api/listings/search'
        : kind < 7
          ? `/api/listings/${listings[index % listings.length].id}/detail`
          : kind === 7
            ? '/api/listings/home'
            : kind === 8
              ? '/api/auth/session'
              : '/api/orders/search?role=buyer'
    const payload = kind < 5 ? { sort: 'newest', page: String((index % 50) + 1), limit: '10' } : {}
    const begin = performance.now()
    lag.push(begin - scheduled)
    active++
    peakActive = Math.max(peakActive, active)
    try {
      if (authAction) { await authLoad.send(index, port); return }
      if (writes && kind >= capacityBusinessMixPolicy.readSlots) {
        if (databaseFaultMode) await writes.send(index)
        else
          await writes.send(
            Math.floor(index / users.length) + user.writeOffset,
            user,
            index % users.length
          )
        return
      }
      const response = await post(port, path, payload, user)
      if (response.status !== 200) {
        const error = new Error('HTTP response failed')
        error.code = `HTTP_${response.status}`
        throw error
      }
      if (kind < 5) assert.equal(response.value.items.length, 10)
      else if (kind < 7) assert.equal(response.value.id, listings[index % listings.length].id)
      else if (kind === 7) assert.equal(response.value.featured.length, 10)
      else if (kind === 8) assert.equal(response.value.account.id, user.id)
      else assert.ok(response.value.items.length > 0)
    } catch (error) {
      const label =
        authAction ? `auth-${authAction.operation}` : writes && kind >= capacityBusinessMixPolicy.readSlots
          ? 'write'
          : kind < 5
            ? 'search'
            : kind < 7
              ? 'detail'
              : kind === 7
                ? 'home'
                : kind === 8
                  ? 'session'
                  : 'orders'
      const key = `${label}:${error.code ?? (error.name === 'AssertionError' ? 'RESPONSE_CHECK_FAILED' : 'REQUEST_FAILED')}`
      const counts = databaseFault?.expectedFailure(error.code, Date.now(), monotonicNow())
        ? expectedErrors
        : errors
      counts[key] = (counts[key] ?? 0) + 1
      const second = Math.floor((performance.now() - started) / 1000)
      const window = (errorWindows[second] ??= {})
      window[key] = (window[key] ?? 0) + 1
      if (failureSamples.length < 20)
        failureSamples.push({
          index,
          elapsedMs: performance.now() - started,
          kind: label,
          code: error.code,
          name: error.name
        })
    } finally {
      const end = performance.now()
      latency.push(end - begin)
      scheduledLatency.push(end - scheduled)
      active--
      completed++
    }
  }
  console.log(
    `Capacity load started: ${policy.users} users, ${policy.rate} requests/s, ${policy.seconds} seconds, pool ${policy.poolMax}, phases ${policy.writePhases}`
  )
  while (sent < planned) {
    const now = performance.now()
    onTick?.(now - started)
    while (sent < planned && started + (sent * 1000) / policy.rate <= now) {
      const index = sent++
      if (active >= policy.users) {
        dropped++
        continue
      }
      const promise = send(index, started + (index * 1000) / policy.rate)
      promises.add(promise)
      promise.finally(() => promises.delete(promise))
    }
    await sleep(5)
  }
  await Promise.all(promises)
  const elapsed = (performance.now() - started) / 1000
  const errorCount = Object.values(errors).reduce((a, b) => a + b, 0)
  const expectedErrorCount = Object.values(expectedErrors).reduce((a, b) => a + b, 0)
  return {
    planned,
    sent: sent - dropped,
    completed,
    dropped,
    elapsedSeconds: elapsed,
    completedRequestsPerSecond: completed / elapsed,
    distinctUsers: userRequests.size,
    peakActive,
    errors,
    expectedErrors,
    expectedErrorCount,
    successfulResponses: completed - errorCount - expectedErrorCount,
    failureSamples,
    errorWindows,
    errorCount,
    latencyMs: {
      p50: quantile(latency, 0.5),
      p95: quantile(latency, 0.95),
      p99: quantile(latency, 0.99)
    },
    scheduledLatencyMs: {
      p95: quantile(scheduledLatency, 0.95),
      p99: quantile(scheduledLatency, 0.99)
    },
    generatorLagMs: { p95: quantile(lag, 0.95), p99: quantile(lag, 0.99) }
  }
}

try {
  db = await sandbox()
  stage = 'database replication evidence'
  let databaseEvidence
  if (policy.databaseTopology === 'synchronous-ha') {
    const replication = await db.client
      .$queryRaw`SELECT application_name, sync_state, state FROM pg_stat_replication`
    const commit = (await db.client.$queryRaw`SHOW synchronous_commit`)[0].synchronous_commit
    assert.equal(commit, 'remote_apply')
    assert.equal(replication.length, 2)
    assert.ok(replication.every((row) => row.state === 'streaming'))
    assert.ok(replication.some((row) => row.sync_state === 'sync'))
    databaseEvidence = { synchronousCommit: commit, replication }
  }
  stage = 'dataset preparation'
  const users = Array.from({ length: policy.users }, (_, index) => ({
    id: randomUUID(),
    loginName: `capacity-${index}`,
    displayName: `Capacity user ${index}`,
    token: randomBytes(32).toString('base64url')
  }))
  const seller = await db.client.account.create({
    data: { loginName: 'capacity-seller', displayName: 'Capacity seller' }
  })
  await db.client.account.createMany({
    data: users.map(({ id, loginName, displayName }) => ({ id, loginName, displayName }))
  })
  await db.client.session.createMany({
    data: users.map(({ id, token }) => ({
      accountId: id,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + sessionMaxAgeSeconds * 1000)
    }))
  })
  const listings = Array.from({ length: policy.listings }, (_, index) => ({
    id: randomUUID(),
    sellerId: seller.id,
    type: index % 2 ? 'physical' : 'digital',
    category: index % 2 ? 'electronics' : 'digital_assets',
    title: `Capacity listing ${index}`,
    description: 'Isolated capacity fixture',
    priceAmount: '10.00',
    currency: 'USD',
    ...(index % 2 ? {} : { licenseDescription: 'Capacity fixture license', contentVersion: 'v1' })
  }))
  for (let offset = 0; offset < listings.length; offset += 500)
    await db.client.listing.createMany({ data: listings.slice(offset, offset + 500) })
  await db.client.physicalInventory.createMany({
    data: listings.filter((item) => item.type === 'physical').map(({ id }) => ({ listingId: id }))
  })
  for (let offset = 0; offset < users.length; offset += 10)
    await Promise.all(
      users.slice(offset, offset + 10).map((user, index) =>
        db.market.create(user.id, randomUUID(), {
          listingId: listings[(offset + index) * 2].id,
          version: 1
        })
      )
    )
  const baselineIds = databaseFaultMode
    ? (await db.client.order.findMany({ select: { id: true } })).map((order) => order.id)
    : []
  if (databaseFaultMode) assert.equal(baselineIds.length, users.length)
  const baselineState = async () =>
    db.client.order.findMany({
      where: { id: { in: baselineIds } },
      orderBy: { id: 'asc' },
      include: {
        snapshot: true,
        shipping: true,
        reservationOrderRows: true,
        eventOrderRows: { orderBy: { id: 'asc' } },
        idempotencyOrderRows: { orderBy: { key: 'asc' } }
      }
    })
  const baselineBefore = databaseFaultMode ? JSON.stringify(await baselineState()) : undefined
  const password = randomUUID()
  privateValues.push(password)
  stage = 'runtime role preparation'
  await db.client.$executeRawUnsafe(
    `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
  )
  roleCreated = true
  await grantRuntime(db.client, db.schema, role)
  const runtimeUrl = new URL(db.url)
  runtimeUrl.username = role
  runtimeUrl.password = password
  privateValues.push(runtimeUrl.toString())
  const runtimeUrls = capacityDatabaseUrls(runtimeUrl, policy.secondDatabaseAddress)
  privateValues.push(runtimeUrls[1].toString())
  stage = 'API startup'
  const instances = [await startApi(runtimeUrls[0]), await startApi(runtimeUrls[1])]
  if (authMode) {
    authLoad = capacityAuth({ users, policy, post, instances, password: randomUUID(),
      registerSecret: (value) => privateValues.push(value) })
    stage = 'real authentication credential preparation'
    await authLoad.seed(db.client)
  }
  gateway = await capacityGateway(instances, { virtualClients: authLoad?.virtualClients })
  const port = gateway.server.address().port
  if (authLoad) {
    stage = 'real HTTP authentication preparation'
    await authLoad.prepare(port)
    console.log(JSON.stringify({ event: 'capacity_auth_prepared', ...authLoad.summary() }))
  }
  stage = 'HTTP preflight'
  let checking = false
  const healthStarted = performance.now()
  healthTimer = setInterval(() => {
    if (checking) return
    checking = true
    void Promise.all(
      instances.map(async (instance) => {
        let healthy, status, code
        try {
          const response = await post(instance.port, '/api/health/ready')
          status = response.status
          healthy = status === 200
          if (/^[A-Z_]+$/.test(response.value.code ?? '')) code = response.value.code
        } catch (error) {
          healthy = false
          code = error.code
        }
        if (instance.healthy !== healthy)
          healthTransitions.push({
            pid: instance.pid,
            elapsedMs: performance.now() - healthStarted,
            healthy,
            status,
            code
          })
        instance.healthy = healthy
      })
    ).finally(() => {
      checking = false
    })
  }, 200)
  for (const [path, payload] of [
    ['/api/listings/search', { limit: '10' }],
    ['/api/listings/home', {}],
    ['/api/orders/search?role=buyer', {}],
    ['/api/auth/session', {}],
    [`/api/listings/${listings[5].id}/detail`, {}]
  ]) {
    const response = await post(port, path, payload, users[0])
    console.log(
      JSON.stringify({
        event: 'capacity_preflight',
        path,
        status: response.status,
        publicErrorCode: response.value.code,
        fields: Object.keys(response.value)
      })
    )
    assert.equal(response.status, 200)
  }
  for (let i = 0; i < 100; i++)
    assert.equal((await post(port, '/api/listings/search', { limit: '10' })).status, 200)
  const faults = { killed: false, restartRequested: false, restarted: false, events: [] }
  const actions = []
  const writes = databaseFaultMode
    ? capacityOutageWrites(
        async (path, payload, user, key) => {
          const startedAt = Date.now()
          const startedMonoNs = monotonicNow()
          const response = await post(port, path, payload, user, key)
          if (response.status === 200) databaseFault.writeSucceeded(startedAt, Date.now(), startedMonoNs, monotonicNow())
          return response
        },
        users,
        listings.filter((item) => item.type === 'physical'),
        policy.rate * policy.seconds
      )
    : writeMode
      ? capacityWrites(
          (path, payload, user, key) => post(port, path, payload, user, key),
          listings.filter((item) => item.type === 'physical')
        )
      : undefined
  let writeWarmup
  stage = 'write warmup'
  if (databaseFaultMode) {
    console.log(
      JSON.stringify({ event: 'capacity_write_warmup_started', planned: writes.summary().planned })
    )
    const warmupStarted = performance.now()
    await writes.prepare()
    console.log(
      JSON.stringify({
        event: 'capacity_write_warmup_complete',
        elapsedMs: performance.now() - warmupStarted
      })
    )
  } else if (writes) {
    for (let offset = 0; offset < users.length; offset += 10) {
      await Promise.all(
        users.slice(offset, offset + 10).map(async (user, localIndex) => {
          const index = offset + localIndex
          if (index % capacityBusinessMixPolicy.slots < capacityBusinessMixPolicy.readSlots) return
          user.writeOffset = policy.writePhases === 'aligned' ? 0 :
            Math.floor(index / capacityBusinessMixPolicy.slots) % Object.keys(writes.stats).length
          for (let round = 0; round < user.writeOffset; round++)
            await writes.send(round, user, index)
        })
      )
    }
    writeWarmup = { ...writes.stats }
  }
  if (gatewayFaultMode) gatewayProbes = capacityGatewayProbes({ fault: databaseFault, writes, instances, processes, post })
  gateway.stats.attempts.fill(0)
  gateway.stats.completed.fill(0)
  stopResources = await capacityResources(
    processes,
    db.client,
    role,
    policy.databaseTopology,
    () => !gatewayFaultMode && (databaseFault?.expectedFailure('HTTP_503', Date.now()) ?? false)
  )
  stage = 'measured load'
  const result = await load(
    port,
    users,
    listings,
    (elapsedMs) => {
      if (
        databaseFaultMode &&
        !faultRequested &&
        elapsedMs >= capacityDatabaseFaultPolicy.injectAfterMs
      ) {
        faultRequested = true
        process.send({ event: 'inject-database-fault' })
      }
      if (!faultMode) return
      if (!faults.killed && elapsedMs >= capacityApiFaultPolicy.injectAfterMs) {
        faults.killed = true
        const child = processes.find((process) => process.pid === instances[0].pid)
        faults.events.push({ action: 'SIGKILL', elapsedMs, pid: child.pid })
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        actions.push(exited)
        console.log('Capacity fault: first API killed; remaining API must carry 500 requests/s')
      }
      if (!faults.restartRequested && elapsedMs >= capacityApiFaultPolicy.replaceAfterMs) {
        faults.restartRequested = true
        const restartStarted = performance.now()
        actions.push(
          startApi(runtimeUrls[0]).then((instance) => {
            instances[0] = instance
            faults.restarted = true
            faults.events.push({
              action: 'ready',
              elapsedMs: elapsedMs + performance.now() - restartStarted,
              pid: instance.pid
            })
            console.log('Capacity fault: replacement API ready and rejoined')
          })
        )
      }
    },
    writes
  )
  const loadRouting = {
    ...gateway.stats,
    attempts: [...gateway.stats.attempts],
    completed: [...gateway.stats.completed]
  }
  await Promise.all(actions)
  if (databaseFaultMode) {
    const deadline = Date.now() + capacityDatabaseFaultPolicy.controlTimeoutMs
    while (!faultControlFinished && Date.now() < deadline) await sleep(50)
    assert.ok(faultControlFinished, 'Database fault controller timed out')
    assert.ok(!databaseFault.report.controllerFailed, 'Database fault controller failed')
  }
  if (gatewayProbes) await gatewayProbes.finish()
  clearInterval(healthTimer)
  healthTimer = undefined
  const resources = await stopResources()
  stopResources = undefined
  let persistedWrites, writeCompetition, authentication
  if (authLoad) {
    stage = 'authentication audit'
    try { authentication = await authLoad.audit(db.client, policy.seconds) }
    catch {
      authentication = { verified: false, ...authLoad.summary() }
      result.errors.authentication_audit = 1
      result.errorCount++
    }
  }
  stage = 'write audit'
  if (writes) {
    try {
      if (databaseFaultMode) {
        databaseFault.verify()
        const drainStarted = performance.now()
        console.log(
          JSON.stringify({
            event: 'capacity_post_load_reconciliation_started',
            sent: result.sent,
            completed: result.completed,
            dropped: result.dropped,
            writes: writes.summary()
          })
        )
        await writes.reconcile()
        databaseFault.report.drainMs = performance.now() - drainStarted
        persistedWrites = { ...(await writes.audit(db.client)), ...writes.summary() }
        assert.equal(
          JSON.stringify(await baselineState()),
          baselineBefore,
          'Pre-fault baseline orders or business rows changed'
        )
      } else {
        persistedWrites = await writes.audit(db.client)
        const expected = { ...writeWarmup }
        const phases = Object.keys(expected)
        for (let index = 0; index < policy.rate * policy.seconds; index++) {
          if (index % capacityBusinessMixPolicy.slots >= capacityBusinessMixPolicy.readSlots)
            expected[
              phases[
                (Math.floor(index / users.length) + users[index % users.length].writeOffset) %
                  phases.length
              ]
            ]++
        }
        assert.deepEqual(writes.stats, expected)
        writeCompetition = await checkWriteCompetition(instances, users, listings.at(-1))
      }
    } catch {
      result.errors.persistence_or_competition_check = 1
      result.errorCount++
    }
  }
  const report = {
    timestamp: new Date().toISOString(),
    scope: faultMode
      ? 'mixed read load with API SIGKILL and replacement; no write, login or database failover'
      : 'mixed read baseline; no login, write or failover load',
    policy,
    profilingEnabled,
    databaseEvidence,
    databaseIngress: { mode: policy.secondDatabaseAddress ? 'dual' : 'shared',
      apiEndpoints: runtimeUrls.map((url, apiIndex) => ({ apiIndex, address: url.host })) },
    databaseFault: databaseFault?.report,
    dataset: {
      accounts: users.length + 1,
      sessions: authLoad ? await db.client.session.count() : users.length,
      initialSessionFixtures: authLoad ? users.length : undefined,
      listings: listings.length,
      orders: users.length
    },
    host: {
      platform: platform(),
      arch: arch(),
      logicalCpu: availableParallelism(),
      memoryBytes: totalmem()
    },
    instances: instances.map(({ pid }) => ({ pid, poolMax: policy.poolMax })),
    routing: gateway.stats,
    routingScope: 'measured load plus post-load reconciliation',
    loadRouting,
    postLoadRouting: {
      attempts: gateway.stats.attempts.map((count, index) => count - loadRouting.attempts[index]),
      completed: gateway.stats.completed.map(
        (count, index) => count - loadRouting.completed[index]
      ),
      readRetries: gateway.stats.readRetries - loadRouting.readRetries,
      writeRetries: gateway.stats.writeRetries - loadRouting.writeRetries
    },
    faults,
    healthTransitions,
    resources,
    result,
    authentication
  }
  await mkdir('.tmp', { recursive: true })
  report.persistedWrites = persistedWrites
  report.writeWarmup = writeWarmup
  report.writeRecovery = writes?.recovery
  report.writeRecoveryPolicy = databaseFaultMode
    ? { arrivalAttempts: 1, recovery: 'original-key replay after measured load' }
    : writeMode
      ? capacityWritePolicy
      : undefined
  report.writeCompetition = writeCompetition
  if (writeMode)
    report.scope = `80% read and 20% create/replay/cancel/replay writes${faultMode ? ' with API SIGKILL and replacement' : ''}; no password login or database failover`
  if (databaseFaultMode)
    report.scope = `80% reads and 20% independent create/replay/cancel/replay arrivals with real ${policy.databaseFault}; post-load drain separately counted; no API restart or password login load`
  if (authMode) report.scope = `398 reads,100 business commands,1 password login/rotation,1 session read per500 scheduled arrivals/s;32 real password actors,968 seeded-session actors; authentication probes outside measured load; synthetic loopback proxy identities${faultMode ? '; API SIGKILL and replacement' : ''}`
  const workload = databaseFaultMode
    ? gatewayFaultMode
      ? 'database-gateway-failover'
      : policy.databaseFault === 'primary-kill'
        ? 'database-primary-failover'
        : 'database-replicas-protection'
    : writeMode
      ? policy.writePhases === 'aligned'
        ? 'concentrated-writes'
        : 'mixed-writes'
      : faultMode
        ? 'api-failover'
        : 'read-baseline'
  const suffix = `${policy.databaseTopology === 'synchronous-ha' ? '-ha' : ''}${policy.secondDatabaseAddress ? '-dual-ingress' : ''}${writeMode && faultMode ? '-api-failover' : ''}${policy.poolMax === readCapacityPolicy({}).poolMax ? '' : `-pool${policy.poolMax}`}${policy.seconds === readCapacityPolicy({}).seconds ? '' : `-${policy.seconds}s`}`
  const reportFile = `.tmp/capacity-${workload}${authMode ? '-auth' : ''}${suffix}${profilingEnabled ? '-profile' : ''}.json`
  const reportText = JSON.stringify(report, null, 2) + '\n'
  await writeFile(reportFile, reportText, { mode: 0o600 })
  console.log(
    JSON.stringify({
      event: 'capacity_result',
      result,
      persistedWrites,
      writeWarmup,
      writeRecovery: writes?.recovery,
      writeCompetition,
      routing: gateway.stats,
      resources: {
        api: resources.api,
        peakDbConnections: Math.max(...resources.samples.map((sample) => sample.total))
      }
    })
  )
  stage = 'report gates'
  assert.equal(resources.clock.valid, true, 'Wall clock changed relative to monotonic time; capacity evidence is invalid')
  assert.equal(resources.failedSamples, false)
  if (policy.databaseTopology === 'synchronous-ha')
    verifyCapacityReplication(resources.samples, databaseFault)
  assert.equal(gateway.stats.writeRetries, 0)
  if (faultMode) assert.equal(faults.restarted, true)
  assert.equal(result.distinctUsers, policy.users)
  assert.equal(result.dropped, 0)
  assert.equal(result.errorCount, 0)
  assert.ok(result.completedRequestsPerSecond >= policy.rate * 0.98)
  assert.ok(result.generatorLagMs.p99 < 100, 'Generator could not sustain arrival rate')
  if (process.send)
    await new Promise((resolve, reject) =>
      process.send(
        {
          event: 'capacity-report-verified',
          file: reportFile,
          sha256: digest(reportText),
          timestamp: report.timestamp
        },
        (error) => (error ? reject(error) : resolve())
      )
    )
} catch (error) {
  let reason = String(error?.message ?? error)
  for (const value of privateValues) if (value) reason = reason.replaceAll(value, '[redacted]')
  console.error(`Capacity check failed at ${stage}: ${reason.slice(0, 500)}`)
  process.exitCode = 1
} finally {
  gatewayProbes?.close()
  clearInterval(healthTimer)
  if (stopResources) await stopResources()
  agent.destroy()
  if (gateway) await gateway.close()
  await Promise.all(
    processes.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
      try {
        await exited
      } finally {
        clearTimeout(timer)
      }
    })
  )
  if (db) {
    // Drop role grants before dropping only the schema created by this run.
    if (roleCreated) await db.client.$executeRawUnsafe(`DROP OWNED BY "${role}"`)
    if (roleCreated) await db.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await db.close()
  }
  if (process.connected) process.disconnect()
}
