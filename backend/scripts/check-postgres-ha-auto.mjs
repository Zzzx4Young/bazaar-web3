import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { DatabaseService } from '../dist/database/database.service.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { grantRuntime } from './runtime-grants.mjs'
import { cli } from '../tests/helpers/database.mjs'
import { checkDcsPartition } from './ha-auto-partition.mjs'
import { capacityDatabaseFaultPolicy } from './capacity-database-fault.mjs'
import { haDataNodes, checkProcessFreeze } from './ha-auto-process-freeze.mjs'
import { monotonicNow } from './capacity-monotonic.mjs'
import { checkGatewayFailure } from './ha-auto-gateway-failure.mjs'
import { capacitySetupAfterClockPreflight } from './capacity-clock-preflight.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const project = `bazaar-ha-auto-${randomUUID().replaceAll('-', '')}`
const origin = 'http://localhost:3000'
const nodes = haDataNodes
const schema = 'bazaar_ha_auto'
const runtimeRole = 'bazaar_ha_runtime'
const capacityMode = process.argv[2] === '--capacity'
const processFreezeMode = process.argv[2] === '--process-freeze'
const gatewayFailureMode = process.argv[2] === '--gateway-failure'
let capacityChildExitCode, capacityReport, processFreezeReport, gatewayFailureReport, clockPreflight
assert.ok(
  process.argv.length === 2 || (process.argv.length === 3 && (capacityMode || processFreezeMode || gatewayFailureMode)),
  'Unknown HA check argument'
)
const policy = {
  rtoMs: 60000,
  pollMs: 250,
  requestTimeoutMs: 6000,
  noReplicaObservationMs: 15000,
  noQuorumObservationMs: 15000,
  orders: 50
}
const children = [],
  secrets = [],
  connections = []
let env,
  directory,
  database,
  stage = 'prepare',
  cleaned = true
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rest = new Map()

async function docker(...args) {
  const paths = [
    'HA_ADMIN_PASSWORD_FILE',
    'HA_REPLICATION_PASSWORD_FILE',
    'HA_REST_PASSWORD_FILE',
    'HA_WRITER_PORT',
    'HA_WRITER2_PORT'
  ].map((name) => `${name}=${env[name]}`)
  const child = spawn('sudo', ['-n', 'env', ...paths, 'docker', ...args], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = '',
    diagnostics = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk
  })
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', resolve)
    })
    if (code !== 0) {
      for (const secret of secrets) diagnostics = diagnostics.replaceAll(secret, '[redacted]')
      console.error(diagnostics.slice(-4000))
      throw new Error('Isolated HA Docker command failed')
    }
    return output.trim()
  } finally {
    clearTimeout(timer)
  }
}

const compose = (...args) =>
  docker('compose', '-f', 'infra/compose.ha-auto.yaml', '-p', project, ...args)

async function address(service, port) {
  const mapped = await compose('port', service, String(port))
  assert.match(mapped, /^127\.0\.0\.1:\d+$/)
  return mapped
}

async function topology() {
  return Promise.all(
    nodes.map(async (name) => {
      try {
        const response = await fetch(`${rest.get(name)}/patroni`, {
          signal: AbortSignal.timeout(1500)
        })
        const value = await response.json()
        return { name, ...value }
      } catch {
        return { name, state: 'unavailable' }
      }
    })
  )
}

async function writerEligibility() {
  return Promise.all(
    nodes.map(async (name) => {
      const response = await fetch(`${rest.get(name)}/primary`, {
        signal: AbortSignal.timeout(1500)
      })
      return { name, status: response.status, ...(await response.json()) }
    })
  )
}

async function until(check, timeout = policy.rtoMs) {
  const end = performance.now() + timeout
  while (performance.now() < end) {
    try {
      const result = await check()
      if (result) return result
    } catch {
      /* Transient outage is expected during election. */
    }
    await sleep(policy.pollMs)
  }
  throw new Error('HA condition timed out')
}

async function post(api, path, payload = {}, session, key, timeout = policy.requestTimeoutMs) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
    headers: {
      origin,
      'content-type': 'application/json',
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrfToken } : {}),
      ...(key ? { 'idempotency-key': key } : {})
    },
    body: JSON.stringify(payload)
  })
  return {
    status: response.status,
    value: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  }
}

async function startApi(url) {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      DATABASE_URL_FILE: '',
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_ORIGIN: origin,
      DB_POOL_MAX: '5',
      TRUSTED_PROXY_CIDRS: ''
    },
    stdio: ['ignore', 'ignore', 'ignore']
  })
  children.push(child)
  const api = `http://127.0.0.1:${port}`
  await until(async () => {
    assert.equal(child.exitCode, null)
    return (await post(api, '/api/health/ready')).status === 200
  })
  return api
}

async function businessState(client, ids) {
  return client.order.findMany({
    where: { id: { in: ids } },
    orderBy: { id: 'asc' },
    include: {
      snapshot: true,
      shipping: true,
      reservationOrderRows: true,
      eventOrderRows: true,
      inventoryOrderRows: true,
      idempotencyOrderRows: true
    }
  })
}

try {
  await mkdir(new URL('../.tmp/', import.meta.url), { recursive: true })
  const prepareDirectory = () => mkdtemp(fileURLToPath(new URL('../.tmp/ha-auto-', import.meta.url)))
  if (capacityMode) {
    stage = 'capacity environment clock preflight'
    console.log('Capacity clock preflight: observing before isolated resources are created')
    directory = await capacitySetupAfterClockPreflight({
      persistReport: async (report) => {
        clockPreflight = report
        await writeFile(new URL('../.tmp/capacity-clock-preflight.json', import.meta.url),
          JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
        console.log(JSON.stringify({ event: 'capacity_clock_preflight', valid: report.valid,
          elapsedMs: report.clock?.elapsedMs, maxAbsoluteDriftMs: report.clock?.maxAbsoluteDriftMs,
          failure: report.failure }))
      },
      setup: prepareDirectory
    })
  } else directory = await prepareDirectory()
  stage = 'prepare isolated resources'
  env = { ...process.env }
  cleaned = false
  for (const [variable, file] of [
    ['HA_ADMIN_PASSWORD_FILE', 'admin'],
    ['HA_REPLICATION_PASSWORD_FILE', 'replication'],
    ['HA_REST_PASSWORD_FILE', 'rest']
  ]) {
    const password = randomBytes(32).toString('hex')
    secrets.push(password)
    env[variable] = `${directory}/${file}`
    await writeFile(env[variable], password, { mode: 0o600 })
  }
  // Keep original API endpoints stable across container stop/start.
  const reservations = [createServer(), createServer()]
  await Promise.all(reservations.map(async (server) => {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
  }))
  env.HA_WRITER_PORT = String(reservations[0].address().port)
  env.HA_WRITER2_PORT = String(reservations[1].address().port)
  await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))))
  stage = 'cluster bootstrap'
  await compose('up', '-d', '--wait', '--wait-timeout', '120')
  for (const node of nodes) rest.set(node, `http://${await address(node, 8008)}`)
  const initialPrimary = await until(async () => {
    const state = await topology()
    const primary = state.filter((node) => node.role === 'primary' && node.state === 'running')
    return primary.length === 1 &&
      state.filter((node) => node.role === 'replica' && node.state === 'running').length === 2
      ? primary[0].name
      : undefined
  })
  const dynamic = await (await fetch(`${rest.get(initialPrimary)}/config`)).json()
  assert.equal(dynamic.synchronous_mode, true)
  assert.equal(dynamic.synchronous_mode_strict, true)
  stage = 'database ingress addresses'
  const writer = await address('writer', 5432)
  const secondWriter = await address('writer2', 5432)
  assert.notEqual(writer, secondWriter)
  const gatewayCapacityFault = capacityMode && process.env.CAPACITY_DATABASE_FAULT === 'gateway-kill'
  const adminWriter = gatewayCapacityFault ? secondWriter : writer
  const adminUrl = new URL(`postgresql://bazaar_ha_admin@${adminWriter}/postgres?schema=${schema}`)
  adminUrl.password = secrets[0]
  database = new DatabaseService(adminUrl.toString())
  connections.push(database)
  await database.onModuleInit()
  await until(async () => {
    const rows = await database.client.$queryRaw`SELECT sync_state, state FROM pg_stat_replication`
    return (
      rows.length === 2 &&
      rows.every((row) => row.state === 'streaming') &&
      rows.some((row) => row.sync_state === 'sync')
    )
  })
  assert.equal(
    (await database.client.$queryRaw`SHOW synchronous_commit`)[0].synchronous_commit,
    'remote_apply'
  )
  await database.client.$executeRawUnsafe(
    capacityMode ? 'CREATE DATABASE bazaar_test' : 'CREATE DATABASE bazaar_ha_auto'
  )
  await database.onModuleDestroy()
  connections.pop()
  adminUrl.pathname = capacityMode ? '/bazaar_test' : '/bazaar_ha_auto'
  database = new DatabaseService(adminUrl.toString())
  connections.push(database)
  await database.onModuleInit()
  if (capacityMode) {
    stage = 'synchronous HA capacity load'
    const databaseFaultMode = process.env.CAPACITY_DATABASE_FAULT ?? 'none'
    const databaseFault = ['primary-kill', 'replicas-stop', 'gateway-kill'].includes(databaseFaultMode)
    const child = spawn(process.execPath, ['scripts/check-capacity.mjs'], {
      env: {
        ...process.env,
        TEST_DATABASE_URL: adminUrl.toString(),
        CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha',
        CAPACITY_SECOND_DATABASE_ADDRESS: gatewayCapacityFault ? writer : secondWriter,
        CAPACITY_WRITES: '1'
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    })
    children.push(child)
    child.on('message', (message) => {
      if (message?.event === 'capacity-report-verified') capacityReport = message
    })
    let faultTask, faultError, gatewayKillReady = false
    if (databaseFault)
      child.on('message', (message) => {
        if (message?.event === 'database-gateway-kill-ready') { gatewayKillReady = true; return }
        if (message?.event !== 'inject-database-fault' || faultTask) return
        faultTask = (async () => {
          const startedAt = Date.now()
          child.send({ event: 'database-fault-started', startedAt, startedMonoNs: monotonicNow() })
          if (gatewayCapacityFault) {
            console.log('HA capacity: killing only writer gateway; database replication must stay healthy')
            const gatewayContainer = await compose('ps', '-q', 'writer')
            assert.match(gatewayContainer, /^[a-f0-9]{64}$/)
            child.send({ event: 'database-gateway-kill-starting', killCommandStartedAt: Date.now(),
              killCommandStartedMonoNs: monotonicNow() })
            await until(() => gatewayKillReady)
            await compose('kill', '-s', 'SIGKILL', 'writer')
            const [stoppedGateway] = JSON.parse(await docker('inspect', gatewayContainer))
            assert.equal(stoppedGateway.Config.Labels['com.docker.compose.project'], project)
            assert.equal(stoppedGateway.Config.Labels['com.docker.compose.service'], 'writer')
            assert.equal(stoppedGateway.State.Running, false)
            const killedAt = Date.now()
            child.send({ event: 'database-gateway-killed', killedAt, killedMonoNs: monotonicNow() })
            await sleep(capacityDatabaseFaultPolicy.gatewayProtectionMs)
            const restartAt = Date.now()
            const restartMonoNs = monotonicNow()
            await compose('start', 'writer')
            assert.equal(await address('writer', 5432), writer)
            const restoredAt = Date.now()
            child.send({ event: 'database-gateway-restored', restartAt, restoredAt, restartMonoNs,
              restoredMonoNs: monotonicNow(), endpointUnchanged: true })
            const primaries = (await topology()).filter((node) => node.role === 'primary' && node.state === 'running')
            assert.equal(primaries.length, 1)
            assert.equal(primaries[0].name, initialPrimary)
            child.send({ event: 'database-fault-complete', primary: initialPrimary, initialPrimary, restoredAt })
            return
          }
          if (databaseFaultMode === 'replicas-stop') {
            const replicas = nodes.filter((node) => node !== initialPrimary)
            console.log('HA capacity: stopping both isolated replicas during continuous load')
            await compose('kill', '-s', 'SIGKILL', ...replicas)
            const stoppedAt = Date.now()
            await until(async () => {
              const rows = await database.client.$queryRaw`SELECT state FROM pg_stat_replication`
              const names = (await database.client.$queryRaw`SHOW synchronous_standby_names`)[0]
                .synchronous_standby_names
              assert.ok(names.trim(), 'Synchronous barrier disabled without replicas')
              return rows.length === 0
            })
            const zeroReplicaObservedAt = Date.now()
            child.send({ event: 'database-replicas-stopped', stoppedAt, zeroReplicaObservedAt })
            await sleep(capacityDatabaseFaultPolicy.replicaProtectionMs)
            child.send({ event: 'database-replicas-restarting', restartAt: Date.now() })
            await compose('start', replicas[0])
            await until(async () => {
              const rows = await database.client
                .$queryRaw`SELECT state, sync_state FROM pg_stat_replication`
              return rows.some((row) => row.state === 'streaming' && row.sync_state === 'sync')
            })
            await compose('start', replicas[1])
            await until(async () => {
              const rows = await database.client
                .$queryRaw`SELECT state, sync_state FROM pg_stat_replication`
              return (
                rows.length === 2 &&
                rows.every((row) => row.state === 'streaming') &&
                rows.some((row) => row.sync_state === 'sync')
              )
            })
            const primaries = (await topology()).filter(
              (node) => node.role === 'primary' && node.state === 'running'
            )
            assert.equal(primaries.length, 1)
            assert.equal(primaries[0].name, initialPrimary)
            child.send({
              event: 'database-fault-complete',
              primary: initialPrimary,
              initialPrimary,
              restoredAt: Date.now()
            })
            return
          }
          console.log('HA capacity: killing isolated primary during continuous load')
          await compose('kill', '-s', 'SIGKILL', initialPrimary)
          child.send({ event: 'database-primary-killed', killedAt: Date.now() })
          const primary = await until(async () => {
            const running = (await topology()).filter(
              (node) => node.role === 'primary' && node.state === 'running'
            )
            return running.length === 1 && running[0].name !== initialPrimary
              ? running[0].name
              : undefined
          })
          await compose('start', initialPrimary)
          await until(async () => {
            const rows = await database.client
              .$queryRaw`SELECT state, sync_state FROM pg_stat_replication`
            return (
              rows.length === 2 &&
              rows.every((row) => row.state === 'streaming') &&
              rows.some((row) => row.sync_state === 'sync')
            )
          })
          child.send({
            event: 'database-fault-complete',
            primary,
            restoredAt: Date.now(),
            initialPrimary
          })
        })().catch((error) => {
          faultError = error
          if (child.connected) child.send({ event: 'database-fault-failed' })
        })
      })
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', resolve)
    })
    capacityChildExitCode = code
    if (databaseFault) {
      assert.ok(faultTask, 'Capacity child never requested database fault')
      await faultTask
      assert.equal(faultError, undefined, 'Database fault controller failed')
    }
    assert.equal(code, 0, 'Synchronous HA capacity load failed')
    assert.ok(capacityReport, 'Missing verified capacity report')
    const replication = await database.client
      .$queryRaw`SELECT state, sync_state FROM pg_stat_replication`
    assert.equal(replication.length, 2)
    assert.ok(replication.every((row) => row.state === 'streaming'))
    assert.ok(replication.some((row) => row.sync_state === 'sync'))
    console.log('HA capacity: synchronous three-node topology verified before and after load')
  } else {
    await cli(['migrate', 'deploy'], adminUrl)
    const runtimePassword = randomBytes(32).toString('hex')
    secrets.push(runtimePassword)
    await database.client.$executeRawUnsafe(
      `CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`
    )
    await grantRuntime(database.client, schema, runtimeRole)
    const password = `HA-${randomUUID()}`
    secrets.push(password)
    await provisionAccounts(database.client, [
      { loginName: 'ha-seller', displayName: 'HA seller', password },
      { loginName: 'ha-buyer', displayName: 'HA buyer', password }
    ])
    const seller = await database.client.account.findUniqueOrThrow({
      where: { loginName: 'ha-seller' }
    })
    const buyer = await database.client.account.findUniqueOrThrow({
      where: { loginName: 'ha-buyer' }
    })
    const listings = Array.from({ length: policy.orders + 4 }, (_, index) => ({
      id: randomUUID(),
      sellerId: seller.id,
      type: 'physical',
      category: 'electronics',
      title: `HA auto item ${index}`,
      description: 'Isolated HA auto fixture',
      priceAmount: '10.00',
      currency: 'USD'
    }))
    await database.client.listing.createMany({ data: listings })
    await database.client.physicalInventory.createMany({
      data: listings.map((item) => ({ listingId: item.id }))
    })
    const runtimeUrl = new URL(adminUrl)
    runtimeUrl.username = runtimeRole
    runtimeUrl.password = runtimePassword
    stage = 'two API business writes'
    const secondRuntimeUrl = new URL(runtimeUrl)
    secondRuntimeUrl.host = secondWriter
    const apis = [await startApi(runtimeUrl), await startApi(secondRuntimeUrl)]
    const login = await post(apis[0], '/api/auth/login', { loginName: 'ha-buyer', password })
    assert.equal(login.status, 200)
    const session = { cookie: login.cookie, csrfToken: login.value.csrfToken }
    const input = (listing) => ({
      listingId: listing.id,
      version: 1,
      shipping: {
        recipient: 'HA test',
        contact: 'Isolated fixture',
        address: 'Isolated HA address'
      }
    })
    const ids = []
    const createKeys = []
    for (let index = 0; index < policy.orders; index++) {
      createKeys.push(randomUUID())
      const response = await post(
        apis[index % apis.length],
        '/api/orders',
        input(listings[index]),
        session,
        createKeys[index]
      )
      assert.equal(response.status, 200)
      ids.push(response.value.orderId)
    }
    const before = await businessState(database.client, ids)
    assert.equal(before.length, policy.orders)
    console.log('HA auto: three data nodes synchronous; 50 HTTP orders confirmed across two APIs')
    if (gatewayFailureMode) {
      stage = 'independent database gateway failures'
      gatewayFailureReport = await checkGatewayFailure({
        project, compose, address, apis, children, post, until, policy,
        session, buyerId: buyer.id, database, businessState, ids, before,
        create: (index, key, api) => post(api, '/api/orders', input(listings[index]), session, key)
      })
      await writeFile(new URL('../.tmp/postgres-ha-gateway-report.json', import.meta.url),
        JSON.stringify(gatewayFailureReport, null, 2) + '\n', { mode: 0o600 })
      console.log(JSON.stringify({ event: 'ha_gateway_failure_result', ...gatewayFailureReport }))
    } else if (processFreezeMode) {
      stage = 'management process freeze'
      const haConfig = JSON.parse(
        await readFile(new URL('../../infra/ha/patroni.json', import.meta.url))
      )
      processFreezeReport = await checkProcessFreeze({
        project,
        nodes,
        compose,
        docker,
        address,
        adminUrl,
        connections,
        database,
        policy,
        writerEligibility,
        until,
        businessState,
        acknowledgedIds: ids,
        leaderKey: `${haConfig.namespace}${haConfig.scope}/leader`,
        create: (key) => post(apis[0], '/api/orders', input(listings[policy.orders]), session, key),
        replay: (key) => post(apis[1], '/api/orders', input(listings[policy.orders]), session, key)
      })
      assert.ok(children.every((child) => child.exitCode === null && child.signalCode === null))
      assert.equal(
        (await post(apis[0], '/api/auth/session', {}, session)).value.account.id,
        buyer.id
      )
      console.log(
        JSON.stringify({
          event: 'ha_process_freeze_result',
          verified: processFreezeReport.verified,
          recoveryToVerifiedWriteMs: processFreezeReport.recoveryToVerifiedWriteMs,
          oldFencedBeforeLeaseExpiry: Boolean(processFreezeReport.fencingVerifiedBeforeLeaseExpiry),
          unfencedOldAfterLeaseExpiry: Boolean(processFreezeReport.firstUnfencedAfterLeaseExpiry),
          dualPrimaryObserved: Boolean(processFreezeReport.firstDualPrimaryObservation),
          confirmedOrdersPreserved: processFreezeReport.confirmedOrdersPreserved,
          resumed: processFreezeReport.managementProcessResumed
        })
      )
      assert.equal(
        processFreezeReport.verified,
        true,
        'Frozen Patroni did not fence PostgreSQL before leader lease expiry'
      )
    } else {
      stage = 'automatic primary failover'
      const started = performance.now()
      await compose('kill', '-s', 'SIGKILL', initialPrimary)
      const newPrimary = await until(async () => {
        const state = await topology()
        const primary = state.filter((node) => node.role === 'primary' && node.state === 'running')
        return primary.length === 1 && primary[0].name !== initialPrimary
          ? primary[0].name
          : undefined
      })
      await until(async () => {
        const persisted = await businessState(database.client, ids)
        assert.deepEqual(persisted, before)
        return true
      })
      const cancelKey = randomUUID()
      await until(
        async () =>
          (await post(apis[1], `/api/orders/${ids[0]}/actions/cancel`, {}, session, cancelKey))
            .status === 200
      )
      const recoveryMs = performance.now() - started
      assert.ok(recoveryMs <= policy.rtoMs)
      // All rows were checked before cancellation; only the intentional cancellation may now differ.
      const after = await businessState(database.client, ids)
      assert.deepEqual(
        after.filter((order) => order.id !== ids[0]),
        before.filter((order) => order.id !== ids[0])
      )
      assert.equal(after.find((order) => order.id === ids[0]).status, 'cancelled')
      assert.equal(
        (await post(apis[0], '/api/auth/session', {}, session)).value.account.id,
        buyer.id
      )
      const created = await post(
        apis[0],
        '/api/orders',
        input(listings[policy.orders]),
        session,
        randomUUID()
      )
      assert.equal(created.status, 200)
      assert.ok(children.every((child) => child.exitCode === null && child.signalCode === null))
      console.log(
        `HA auto: automatic promotion and original API write verified in ${Math.round(recoveryMs)} ms`
      )
      stage = 'old primary rejoin'
      await compose('start', initialPrimary)
      rest.set(initialPrimary, `http://${await address(initialPrimary, 8008)}`)
      await until(async () => {
        const state = await topology()
        return (
          state.filter((node) => node.role === 'primary' && node.state === 'running').length ===
            1 &&
          state.find((node) => node.name === initialPrimary)?.role === 'replica' &&
          (await database.client.$queryRaw`SELECT state FROM pg_stat_replication`).filter(
            (row) => row.state === 'streaming'
          ).length === 2
        )
      })
      console.log('HA auto: old primary rejoined as replica')
      stage = 'all replicas unavailable'
      const backups = nodes.filter((node) => node !== newPrimary)
      await compose('kill', '-s', 'SIGKILL', ...backups)
      await until(
        async () =>
          (await database.client.$queryRaw`SELECT state FROM pg_stat_replication`).length === 0
      )
      const strict = await (await fetch(`${rest.get(newPrimary)}/config`)).json()
      assert.equal(strict.synchronous_mode_strict, true)
      let replayWithoutReplica
      try {
        replayWithoutReplica = await post(
          apis[1],
          '/api/orders',
          input(listings[1]),
          session,
          createKeys[1],
          policy.noReplicaObservationMs
        )
      } catch (error) {
        assert.equal(error.name, 'TimeoutError')
        replayWithoutReplica = { status: 'timeout' }
      }
      console.log(
        JSON.stringify({ event: 'ha_no_replica_replay', status: replayWithoutReplica.status })
      )
      assert.notEqual(
        replayWithoutReplica.status,
        200,
        'Original order command replay was acknowledged without any replica'
      )
      const blockedKey = randomUUID()
      let blocked
      const replicaProbeListing = listings[policy.orders + 1]
      try {
        blocked = await post(
          apis[0],
          '/api/orders',
          input(replicaProbeListing),
          session,
          blockedKey,
          policy.noReplicaObservationMs
        )
      } catch (error) {
        assert.equal(
          error.name,
          'TimeoutError',
          'Write probe failed for a reason other than its observation deadline'
        )
        blocked = { status: 'timeout' }
      }
      console.log(JSON.stringify({ event: 'ha_no_replica_write', status: blocked.status }))
      assert.notEqual(
        blocked.status,
        200,
        'Strict synchronous write was acknowledged without any replica'
      )
      await compose('start', backups[0])
      rest.set(backups[0], `http://${await address(backups[0], 8008)}`)
      await until(async () =>
        (await database.client.$queryRaw`SELECT state, sync_state FROM pg_stat_replication`).some(
          (row) => row.state === 'streaming' && row.sync_state === 'sync'
        )
      )
      const recoveredOriginalReplay = await post(
        apis[1],
        '/api/orders',
        input(listings[1]),
        session,
        createKeys[1]
      )
      assert.equal(recoveredOriginalReplay.status, 200)
      assert.equal(recoveredOriginalReplay.value.orderId, ids[1])
      const recovered = await until(async () => {
        const response = await post(
          apis[0],
          '/api/orders',
          input(replicaProbeListing),
          session,
          blockedKey
        )
        return response.status === 200 ? response : undefined
      })
      const replay = await post(
        apis[1],
        '/api/orders',
        input(replicaProbeListing),
        session,
        blockedKey
      )
      assert.equal(replay.status, 200)
      assert.equal(replay.value.orderId, recovered.value.orderId)
      assert.equal(
        await database.client.order.count({ where: { listingId: replicaProbeListing.id } }),
        1
      )
      assert.equal(
        await database.client.idempotencyRecord.count({
          where: { actorId: buyer.id, key: blockedKey }
        }),
        1
      )
      const [recoveredOrder] = await businessState(database.client, [recovered.value.orderId])
      assert.ok(recoveredOrder.snapshot && recoveredOrder.shipping)
      assert.equal(recoveredOrder.reservationOrderRows.length, 1)
      assert.equal(recoveredOrder.inventoryOrderRows.length, 1)
      assert.equal(recoveredOrder.eventOrderRows.length, 1)
      assert.deepEqual(await businessState(database.client, ids), after)

      stage = 'DCS quorum loss'
      await compose('start', backups[1])
      rest.set(backups[1], `http://${await address(backups[1], 8008)}`)
      await until(async () => {
        const state = await writerEligibility()
        return (
          state.filter((node) => node.status === 200).length === 1 &&
          state.every((node) => node.state === 'running') &&
          (await database.client.$queryRaw`SELECT state FROM pg_stat_replication`).filter(
            (row) => row.state === 'streaming'
          ).length === 2
        )
      })
      const acknowledgedIds = [...ids, created.value.orderId, recovered.value.orderId]
      const beforeQuorumLoss = await businessState(database.client, acknowledgedIds)
      const quorumStarted = performance.now()
      await compose('kill', '-s', 'SIGKILL', 'etcd1', 'etcd2')
      await until(async () => {
        const state = await writerEligibility()
        return state.every((node) => node.status === 503 && node.role !== 'primary')
      })
      const quorumDemotionMs = performance.now() - quorumStarted
      const quorumKey = randomUUID(),
        quorumStatuses = {},
        quorumListing = listings[policy.orders + 2]
      const observationEnds = performance.now() + policy.noQuorumObservationMs
      let quorumProbes = 0
      do {
        const state = await writerEligibility()
        assert.ok(
          state.every((node) => node.status === 503 && node.role !== 'primary'),
          'A writable primary returned without DCS majority'
        )
        const response = await post(
          apis[quorumProbes % apis.length],
          '/api/orders',
          input(quorumListing),
          session,
          quorumKey
        )
        assert.equal(
          response.status,
          503,
          'Unavailable database must return 503 after DCS demotion'
        )
        assert.equal(response.value.code, 'DATABASE_UNAVAILABLE')
        assert.equal(response.value.retryable, true)
        quorumStatuses[response.status] = (quorumStatuses[response.status] ?? 0) + 1
        quorumProbes++
        await sleep(policy.pollMs)
      } while (performance.now() < observationEnds)
      console.log(
        JSON.stringify({
          event: 'ha_no_dcs_quorum',
          demotionMs: quorumDemotionMs,
          probes: quorumProbes,
          statuses: quorumStatuses
        })
      )
      stage = 'DCS quorum recovery'
      const quorumRecoveryStarted = performance.now()
      await compose('start', 'etcd1', 'etcd2')
      await until(
        async () => (await writerEligibility()).filter((node) => node.status === 200).length === 1
      )
      await until(async () => {
        assert.deepEqual(await businessState(database.client, acknowledgedIds), beforeQuorumLoss)
        return true
      })
      const quorumRecovered = await until(async () => {
        const response = await post(
          apis[0],
          '/api/orders',
          input(quorumListing),
          session,
          quorumKey
        )
        return response.status === 200 ? response : undefined
      })
      const quorumRecoveryMs = performance.now() - quorumRecoveryStarted
      assert.ok(quorumRecoveryMs <= policy.rtoMs)
      const quorumReplay = await post(
        apis[1],
        '/api/orders',
        input(quorumListing),
        session,
        quorumKey
      )
      assert.equal(quorumReplay.status, 200)
      assert.equal(quorumReplay.value.orderId, quorumRecovered.value.orderId)
      assert.equal(await database.client.order.count({ where: { listingId: quorumListing.id } }), 1)
      assert.equal(
        await database.client.idempotencyRecord.count({
          where: { actorId: buyer.id, key: quorumKey }
        }),
        1
      )
      assert.equal(
        (await post(apis[1], '/api/auth/session', {}, session)).value.account.id,
        buyer.id
      )
      assert.ok(children.every((child) => child.exitCode === null && child.signalCode === null))
      stage = 'primary DCS network partition'
      const haConfig = JSON.parse(
        await readFile(new URL('../../infra/ha/patroni.json', import.meta.url), 'utf8')
      )
      const networkPartition = await checkDcsPartition({
        project,
        nodes,
        compose,
        docker,
        address,
        adminUrl,
        connections,
        database,
        policy,
        writerEligibility,
        until,
        businessState,
        acknowledgedIds: [...acknowledgedIds, quorumRecovered.value.orderId],
        leaderKey: `${haConfig.namespace}${haConfig.scope}/leader`,
        create: (key) => post(apis[0], '/api/orders', input(listings.at(-1)), session, key),
        replay: (key) => post(apis[1], '/api/orders', input(listings.at(-1)), session, key)
      })
      assert.equal(
        (await post(apis[0], '/api/auth/session', {}, session)).value.account.id,
        buyer.id
      )
      assert.ok(children.every((child) => child.exitCode === null && child.signalCode === null))
      const report = {
        timestamp: new Date().toISOString(),
        policy,
        acknowledgedOrders: ids.length,
        lostAcknowledgedOrders: before.length - after.length,
        originalApiProcessesSurvived: true,
        databaseEndpointUnchanged: true,
        independentDatabaseGateways: true,
        originalSessionVerified: true,
        initialPrimary,
        newPrimary,
        failoverToVerifiedWriteMs: recoveryMs,
        oldPrimaryRejoinedAsReplica: true,
        noReplicaWriteStatus: blocked.status,
        noReplicaReplayStatus: replayWithoutReplica.status,
        recoveredOriginalReplayOrderIdUnchanged: true,
        recoveredSameKeyAfterReplicaReturn: true,
        recoveredWriteHasOneOrderAndIdempotencyRecord: true,
        networkPartition,
        dcsQuorumLoss: {
          demotionMs: quorumDemotionMs,
          observationMs: policy.noQuorumObservationMs,
          probes: quorumProbes,
          statuses: quorumStatuses,
          confirmedOrdersPreserved: acknowledgedIds.length,
          recoveryToVerifiedWriteMs: quorumRecoveryMs,
          sameKeyReplayVerified: true,
          originalSessionVerified: true
        },
        limitations: [
          'same-host containers',
          'two TCP gateways on same host',
          'no host watchdog or external fencing',
          'broader network partition and process freeze tests pending',
          'no capacity load in this low-load fault run'
        ]
      }
      await writeFile(
        new URL('../.tmp/postgres-ha-auto-report.json', import.meta.url),
        JSON.stringify(report, null, 2) + '\n',
        { mode: 0o600 }
      )
      const { samples, ...partitionSummary } = networkPartition
      console.log(
        JSON.stringify({
          event: 'postgres_ha_auto_result',
          report: {
            ...report,
            networkPartition: { ...partitionSummary, sampleCount: samples.length }
          }
        })
      )
    }
  }
} catch (error) {
  console.error(`PostgreSQL automatic HA check failed at stage: ${stage}`)
  let reason = String(error?.stack ?? error?.message ?? error)
  for (const secret of secrets) reason = reason.replaceAll(secret, '[redacted]')
  console.error(reason.slice(0, 1600))
  if (env) {
    try {
      let diagnostics = await compose('logs', '--no-color', '--tail', '40', ...nodes)
      for (const secret of secrets) diagnostics = diagnostics.replaceAll(secret, '[redacted]')
      await writeFile(
        new URL(
          processFreezeMode
            ? '../.tmp/postgres-ha-auto-process-freeze-diagnostics.log'
            : gatewayFailureMode
              ? '../.tmp/postgres-ha-gateway-diagnostics.log'
              : '../.tmp/postgres-ha-auto-diagnostics.log',
          import.meta.url
        ),
        diagnostics,
        { mode: 0o600 }
      )
      console.error(
        diagnostics
          .split('\n')
          .filter((line) => /ERROR|FATAL|rewind|recovery|failed|Traceback/.test(line))
          .join('\n')
      )
    } catch {
      console.error('Could not collect isolated HA diagnostics')
    }
  }
  process.exitCode = 1
} finally {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
      try {
        await exited
      } finally {
        clearTimeout(timer)
      }
    })
  )
  for (const connection of connections) await connection.onModuleDestroy()
  if (env) {
    try {
      await compose('down', '--volumes', '--remove-orphans')
      cleaned = true
    } catch {
      console.error(`HA auto cleanup failed; isolated project retained: ${project}`)
      process.exitCode = 1
    }
  }
  if (cleaned && directory) await rm(directory, { recursive: true, force: true })
  if (processFreezeMode) {
    let report
    try {
      const content = await readFile(
        new URL('../.tmp/postgres-ha-auto-process-freeze-report.json', import.meta.url)
      )
      const value = JSON.parse(content)
      if (value.project === project)
        report = {
          timestamp: value.timestamp,
          file: '.tmp/postgres-ha-auto-process-freeze-report.json',
          sha256: createHash('sha256').update(content).digest('hex'),
          verified: value.verified
        }
    } catch {
      /* A setup failure may not produce experiment observations. */
    }
    await writeFile(
      new URL('../.tmp/postgres-ha-auto-process-freeze-run.json', import.meta.url),
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          project,
          exitCode: process.exitCode ?? 0,
          cleaned,
          report,
          passed: (process.exitCode ?? 0) === 0 && cleaned && report?.verified === true
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    )
  }
  if (gatewayFailureMode) {
    let report
    if (gatewayFailureReport) {
      const content = await readFile(new URL('../.tmp/postgres-ha-gateway-report.json', import.meta.url))
      assert.equal(JSON.parse(content).project, project)
      report = { file: '.tmp/postgres-ha-gateway-report.json', sha256: createHash('sha256').update(content).digest('hex') }
    }
    await writeFile(new URL('../.tmp/postgres-ha-gateway-run.json', import.meta.url),
      JSON.stringify({ completedAt: new Date().toISOString(), project, exitCode: process.exitCode ?? 0, cleaned, report,
        passed: !process.exitCode && cleaned && gatewayFailureReport?.verified === true }, null, 2) + '\n', { mode: 0o600 })
  }
  if (capacityMode) {
    if (capacityReport) {
      assert.match(capacityReport.file, /^\.tmp\/capacity-[a-z0-9-]+\.json$/)
      const content = await readFile(capacityReport.file)
      assert.equal(createHash('sha256').update(content).digest('hex'), capacityReport.sha256)
    }
    await mkdir('.tmp', { recursive: true })
    await writeFile(
      '.tmp/postgres-ha-capacity-run.json',
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          project,
          exitCode: process.exitCode ?? 0,
          childExitCode: capacityChildExitCode,
          cleaned,
          setupStarted: !!env,
          clockPreflight: clockPreflight && { valid: clockPreflight.valid, file: '.tmp/capacity-clock-preflight.json' },
          report: capacityReport,
          passed: !process.exitCode && capacityChildExitCode === 0 && cleaned && !!capacityReport
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    )
  }
}
