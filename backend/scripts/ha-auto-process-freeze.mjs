import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { isDatabaseUnavailable } from '../dist/database/database-errors.js'
import { leaderLease, readLeaseTtl } from './ha-auto-dcs.mjs'

export const haDataNodes = Object.freeze(['pg1', 'pg2', 'pg3'])

const probePool = Object.freeze({
  max: 1,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  statementTimeoutMs: 1000
})
const processMetadataCode = `import json, pathlib
processes = []
for path in pathlib.Path('/proc').iterdir():
  if not path.name.isdigit():
    continue
  try:
    fields = dict(line.split(':', 1) for line in (path / 'status').read_text().splitlines() if ':' in line)
    argv = (path / 'cmdline').read_bytes().split(bytes([0]))
    executable = argv[0].split(bytes([32]))[0].rsplit(b'/', 1)[-1]
    processes.append({'pid': int(path.name), 'parentPid': int(fields['PPid']),
      'state': fields['State'].split()[0], 'isPatroni': b'/opt/patroni/bin/patroni' in argv,
      'isPostmaster': executable == b'postgres',
      'startTicks': (path / 'stat').read_text().rsplit(')', 1)[1].split()[19]})
  except (OSError, KeyError, IndexError):
    continue
supervisor = next(p for p in processes if p['pid'] == 1)
managers = [p for p in processes if p['pid'] != 1 and p['parentPid'] == 1 and p['isPatroni']]
postmasters = [p for p in processes if p['isPostmaster']]
assert len(managers) == 1, 'Expected one Patroni HA worker under PID 1 supervisor'
assert len(postmasters) == 1, 'Expected one live postmaster'
config = json.loads(pathlib.Path('/var/run/ha-patroni/config.json').read_text())
print(json.dumps({'supervisor': supervisor, 'manager': managers[0], 'postgres': postmasters[0],
  'runtimeWatchdogConfiguration': config.get('watchdog', {}).get('mode')}))`

const signalManagerCode = `import os, pathlib, signal, sys
pid = int(sys.argv[1])
assert pid > 1, 'Do not signal the PID 1 supervisor'
path = pathlib.Path('/proc') / str(pid)
argv = (path / 'cmdline').read_bytes().split(bytes([0]))
assert b'/opt/patroni/bin/patroni' in argv, 'Signal target is not Patroni'
fields = dict(line.split(':', 1) for line in (path / 'status').read_text().splitlines() if ':' in line)
assert int(fields['PPid']) == 1, 'Signal target is not the HA worker'
assert (path / 'stat').read_text().rsplit(')', 1)[1].split()[19] == sys.argv[2], 'HA worker identity changed'
signals = {'STOP': signal.SIGSTOP, 'CONT': signal.SIGCONT}
os.kill(pid, signals[sys.argv[3]])`

export function ownedProcessTarget(project, primary, container) {
  assert.match(project, /^bazaar-ha-auto-[a-f0-9]{32}$/)
  assert.ok(haDataNodes.includes(primary), 'Unknown signal target')
  assert.equal(container.Config.Labels['com.docker.compose.project'], project)
  assert.equal(container.Config.Labels['com.docker.compose.service'], primary)
  assert.match(container.Id, /^[a-f0-9]{64}$/)
  assert.equal(container.State.Running, true)
  assert.equal(container.State.Paused, false, 'Container-wide pause is not this experiment')
  assert.ok(Number.isSafeInteger(container.State.Pid) && container.State.Pid > 0)
  return container.Id
}

export function managementProcessTarget(value) {
  assert.equal(value.supervisor.pid, 1)
  assert.equal(value.supervisor.isPatroni, true)
  assert.ok(
    ['R', 'S', 'D', 'I'].includes(value.supervisor.state),
    'Supervisor must remain runnable'
  )
  assert.ok(
    Number.isSafeInteger(value.manager.pid) && value.manager.pid > 1,
    'PID 1 is only the supervisor, not the HA worker'
  )
  assert.equal(value.manager.parentPid, 1)
  assert.equal(value.manager.isPatroni, true)
  assert.match(value.manager.startTicks, /^[0-9]+$/)
  assert.ok(['R', 'S', 'D', 'I', 'T'].includes(value.manager.state))
  assert.ok(Number.isSafeInteger(value.postgres.pid) && value.postgres.pid > 1)
  assert.notEqual(value.manager.pid, value.postgres.pid, 'Postmaster must not be the signal target')
  assert.ok(['R', 'S', 'D', 'I'].includes(value.postgres.state), 'Postmaster must remain runnable')
  return value.manager.pid
}

export function freezeQualification(sample, initialPrimary) {
  assert.ok(haDataNodes.includes(initialPrimary), 'Unknown initial primary')
  assert.ok(
    Number.isSafeInteger(sample.leaseRemainingSeconds) && sample.leaseRemainingSeconds >= -1,
    'Missing original leader lease observation'
  )
  assert.equal(typeof sample.oldContainerRunning, 'boolean', 'Missing old container observation')
  assert.equal(sample.states.length, haDataNodes.length, 'Missing SQL node observations')
  const identities = sample.states.map((state) => state.node)
  assert.equal(new Set(identities).size, haDataNodes.length, 'Duplicate SQL node observation')
  for (const state of sample.states) {
    assert.ok(haDataNodes.includes(state.node), 'Unknown SQL node')
    assert.ok(
      state.unavailable === true ||
        (typeof state.recovering === 'boolean' && ['on', 'off'].includes(state.read_only)),
      'Incomplete SQL role observation'
    )
  }
  const old = sample.states.find((state) => state.node === initialPrimary)
  // Read-only defaults on a primary can be overridden; actual standby recovery or
  // confirmed container termination is stronger fencing evidence. A connection
  // error by itself cannot establish either condition.
  const oldFenced =
    sample.oldContainerRunning === false || (old.recovering === true && old.read_only === 'on')
  const primaries = sample.states.filter(
    (state) =>
      state.recovering === false && (state.node !== initialPrimary || sample.oldContainerRunning)
  )
  const replacements = primaries.filter(
    (state) => state.node !== initialPrimary && state.read_only === 'off'
  )
  return {
    oldFenced,
    replacementPrimary: replacements.length === 1 ? replacements[0].node : undefined,
    unsafeDualPrimary: primaries.length > 1,
    // TTL is rounded down; zero does not yet prove that the lease is absent.
    unfencedAfterLeaseExpiry: sample.leaseRemainingSeconds === -1 && !oldFenced
  }
}

export async function checkProcessFreeze(context) {
  const {
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
    acknowledgedIds,
    leaderKey,
    create,
    replay
  } = context
  assert.deepEqual([...nodes].sort(), [...haDataNodes])
  const eligible = (await writerEligibility()).filter((node) => node.status === 200)
  assert.equal(eligible.length, 1)
  const primary = eligible[0].name
  const container = await compose('ps', '-q', primary)
  const [inspection] = JSON.parse(await docker('inspect', container))
  const target = ownedProcessTarget(project, primary, inspection)
  assert.equal(target, container)
  const inspectTarget = async () => {
    const [value] = JSON.parse(await docker('inspect', target))
    assert.equal(value.Config.Labels['com.docker.compose.project'], project)
    assert.equal(value.Config.Labels['com.docker.compose.service'], primary)
    return value
  }
  const metadata = async () =>
    JSON.parse(await docker('exec', target, '/opt/patroni/bin/python', '-c', processMetadataCode))
  const beforeProcess = await metadata()
  const managerPid = managementProcessTarget(beforeProcess)
  assert.notEqual(beforeProcess.manager.state, 'T')
  const signalManager = (signal) =>
    docker(
      'exec',
      target,
      '/opt/patroni/bin/python',
      '-c',
      signalManagerCode,
      String(managerPid),
      beforeProcess.manager.startTicks,
      signal
    )
  const direct = new Map()
  for (const node of nodes) {
    const url = new URL(adminUrl)
    url.host = await address(node, 5432)
    const connection = new DatabaseService(url.toString(), probePool)
    connections.push(connection)
    await connection.onModuleInit()
    direct.set(node, connection)
  }
  const readState = async (node) => {
    try {
      const [state] = await direct.get(node).client.$queryRaw`
        SELECT pg_is_in_recovery() AS recovering,
          current_setting('transaction_read_only') AS read_only`
      return { node, ...state }
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error
      return { node, unavailable: true }
    }
  }
  const before = await businessState(database.client, acknowledgedIds)
  const report = {
    project,
    initialPrimary: primary,
    samples: [],
    originalApiEndpointUnchanged: true,
    policy,
    limitations: [
      'same-host containers',
      'management-process freeze only',
      'no capacity load',
      'SQL role observations do not prove successful old-node commits'
    ]
  }
  let frozen = false,
    experimentError,
    restoreError
  const started = performance.now()
  try {
    // CONT is required even if a signal command errors after delivering STOP.
    frozen = true
    await signalManager('STOP')
    const process = await metadata()
    assert.equal(managementProcessTarget(process), managerPid)
    assert.equal(process.manager.startTicks, beforeProcess.manager.startTicks)
    assert.equal(process.manager.state, 'T', 'Patroni HA worker did not enter the stopped state')
    report.frozenProcess = process
    const lease = await leaderLease(compose, leaderKey)
    assert.equal(lease.leader, primary)
    assert.ok(lease.remainingSeconds > 0, 'Could not capture the frozen primary live lease')
    report.originalLease = lease
    const old = await readState(primary)
    assert.equal(old.recovering, false, 'PostgreSQL was frozen or stopped with Patroni')
    report.postgresResponsiveAfterManagementFreeze = true
    console.log(
      JSON.stringify({
        event: 'ha_process_frozen',
        primary,
        patroniPid: managerPid,
        patroniState: process.manager.state,
        supervisorState: process.supervisor.state,
        postgresResponsive: true,
        runtimeWatchdogConfiguration: process.runtimeWatchdogConfiguration
      })
    )
    const key = randomUUID()
    while (performance.now() - started < policy.rtoMs) {
      const [leaseRemainingSeconds, states, current] = await Promise.all([
        readLeaseTtl(compose, lease.leaseIdHex),
        Promise.all(nodes.map(readState)),
        inspectTarget()
      ])
      const sample = {
        elapsedMs: performance.now() - started,
        leaseRemainingSeconds,
        states,
        oldContainerRunning: current.State.Running
      }
      const qualification = freezeQualification(sample, primary)
      report.samples.push({ ...sample, qualification })
      if (qualification.oldFenced && leaseRemainingSeconds > 0)
        report.fencingVerifiedBeforeLeaseExpiry ??= {
          elapsedMs: sample.elapsedMs,
          leaseRemainingSeconds
        }
      if (qualification.unfencedAfterLeaseExpiry) report.firstUnfencedAfterLeaseExpiry ??= sample
      if (qualification.unsafeDualPrimary) report.firstDualPrimaryObservation ??= sample
      if (qualification.replacementPrimary) {
        let written
        try {
          written = await create(key)
        } catch (error) {
          if (error.name !== 'TimeoutError' && !isDatabaseUnavailable(error)) throw error
        }
        if (written?.status === 200) {
          report.newPrimary = qualification.replacementPrimary
          report.recoveryToVerifiedWriteMs = performance.now() - started
          assert.ok(report.recoveryToVerifiedWriteMs <= policy.rtoMs)
          const repeated = await replay(key)
          assert.equal(repeated.status, 200)
          assert.equal(repeated.value.orderId, written.value.orderId)
          assert.deepEqual(await businessState(database.client, acknowledgedIds), before)
          const [order] = await businessState(database.client, [written.value.orderId])
          assert.ok(order.snapshot && order.shipping)
          for (const field of [
            'idempotencyOrderRows',
            'reservationOrderRows',
            'eventOrderRows',
            'inventoryOrderRows'
          ])
            assert.equal(order[field].length, 1)
          assert.equal(
            await database.client.order.count({ where: { listingId: order.listingId } }),
            1
          )
          report.confirmedOrdersPreserved = acknowledgedIds.length
          report.sameKeyReplayVerified = true
          break
        }
        if (written)
          assert.ok(
            [502, 503, 504].includes(written.status),
            'Unexpected business response while recovering from process freeze'
          )
      }
      await new Promise((resolve) => setTimeout(resolve, policy.pollMs))
    }
    report.originalLeaseExpired = report.samples.some(
      (sample) => sample.leaseRemainingSeconds === -1
    )
    assert.ok(
      report.originalLeaseExpired,
      'Frozen worker lease did not expire; verify the actual HA-loop signal target'
    )
    assert.ok(report.newPrimary, 'No original API new write recovered within RTO')
  } catch (error) {
    experimentError = error
    report.experimentErrorName = error.name
  } finally {
    if (frozen) {
      try {
        const current = await inspectTarget()
        if (current.State.Running) await signalManager('CONT')
        else await compose('start', primary)
        frozen = false
        await until(async () => {
          const state = await Promise.all(nodes.map(readState))
          return (
            state.filter((node) => node.recovering === false).length === 1 &&
            (!report.newPrimary ||
              state.find((node) => node.node === primary).recovering === true) &&
            (await database.client.$queryRaw`SELECT state FROM pg_stat_replication`).filter(
              (row) => row.state === 'streaming'
            ).length === 2
          )
        })
        assert.deepEqual(await businessState(database.client, acknowledgedIds), before)
        report.managementProcessResumed = true
        report.restoredSinglePrimaryTwoStreaming = true
      } catch (error) {
        restoreError = error
        report.restorationErrorName = error.name
      }
    }
  }
  report.timestamp = new Date().toISOString()
  report.verified =
    !experimentError &&
    !restoreError &&
    Boolean(report.fencingVerifiedBeforeLeaseExpiry) &&
    !report.firstUnfencedAfterLeaseExpiry &&
    !report.firstDualPrimaryObservation
  await writeFile(
    new URL('../.tmp/postgres-ha-auto-process-freeze-report.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 }
  )
  if (restoreError) throw restoreError
  if (experimentError) throw experimentError
  return report
}
