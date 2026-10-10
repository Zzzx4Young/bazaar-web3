import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { recoverOriginalKey } from './ha-original-key-recovery.mjs'
import { leaderLease } from './ha-auto-dcs.mjs'

const probePool = {
  max: 1,
  connectionTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  statementTimeoutMs: 1000
}

async function syncState(compose, leaderKey) {
  const raw = await compose(
    'exec',
    '-T',
    'etcd3',
    'etcdctl',
    '--endpoints=http://127.0.0.1:2379',
    '--command-timeout=3s',
    'get',
    leaderKey.replace(/\/leader$/, '/sync'),
    '-w',
    'json'
  )
  const value = JSON.parse(raw)
  return value.kvs?.length === 1
    ? JSON.parse(Buffer.from(value.kvs[0].value, 'base64').toString())
    : null
}

export async function checkDcsPartition(context) {
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
  await until(
    async () =>
      (await database.client.$queryRaw`SELECT state FROM pg_stat_replication`).filter(
        (row) => row.state === 'streaming'
      ).length === 2
  )
  const eligible = (await writerEligibility()).filter((node) => node.status === 200)
  assert.equal(eligible.length, 1)
  const primary = eligible[0].name
  const initialSync = await until(async () => {
    const value = await syncState(compose, leaderKey)
    const replicas = await database.client
      .$queryRaw`SELECT application_name, state, sync_state FROM pg_stat_replication`
    const selected = (value?.sync_standby ?? '').split(',').map((name) => name.trim())
    return value?.leader === primary &&
      selected.some((name) =>
        replicas.some(
          (row) =>
            row.application_name === name && row.state === 'streaming' && row.sync_state === 'sync'
        )
      )
      ? value
      : undefined
  })
  console.log(JSON.stringify({ event: 'ha_partition_ready', primary, sync: initialSync }))
  const container = await compose('ps', '-q', primary)
  assert.match(container, /^[a-f0-9]{64}$/)
  const network = `${project}_dcs`
  const [inspection] = JSON.parse(await docker('inspect', container))
  assert.equal(inspection.Config.Labels['com.docker.compose.project'], project)
  const originalIp = inspection.NetworkSettings.Networks[network]?.IPAddress
  assert.ok(originalIp)
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
      const [value] = await direct.get(node).client
        .$queryRaw`SELECT pg_is_in_recovery() AS recovering,
        current_setting('transaction_read_only') AS read_only`
      return { node, ...value }
    } catch {
      return { node, unavailable: true }
    }
  }
  assert.equal((await readState(primary)).recovering, false)
  const before = await businessState(database.client, acknowledgedIds)
  const initialLease = await leaderLease(compose, leaderKey)
  assert.equal(initialLease.leader, primary)
  assert.ok(initialLease.remainingSeconds > 0)
  const started = performance.now(),
    samples = []
  let disconnected = false
  try {
    await docker('network', 'disconnect', network, container)
    disconnected = true
    const [isolated] = JSON.parse(await docker('inspect', container))
    assert.ok(!isolated.NetworkSettings.Networks[network])
    assert.ok(
      isolated.NetworkSettings.Networks[`${project}_default`],
      'Database network must remain connected'
    )
    let demotedAt, newPrimary, leaseRemainingAtDemotion
    const deadline = started + policy.rtoMs
    while (performance.now() < deadline) {
      const state = await Promise.all(nodes.map(readState))
      samples.push({ elapsedMs: performance.now() - started, state })
      assert.ok(
        state.filter((node) => node.recovering === false).length <= 1,
        'Two PostgreSQL nodes were writable in the same sample'
      )
      const old = state.find((node) => node.node === primary)
      if (!demotedAt && old.recovering === true && old.read_only === 'on') {
        demotedAt = performance.now() - started
        const retainedLease = await leaderLease(compose, leaderKey)
        assert.equal(retainedLease.leader, primary)
        assert.ok(
          retainedLease.remainingSeconds > 0,
          'Old primary was not verified read-only before its lease expired'
        )
        leaseRemainingAtDemotion = retainedLease.remainingSeconds
        samples.push({
          elapsedMs: performance.now() - started,
          oldPrimaryLeaseRemainingSeconds: retainedLease.remainingSeconds
        })
        console.log(
          JSON.stringify({
            event: 'ha_partition_sql_demotion',
            primary,
            demotedMs: demotedAt,
            leaseRemainingSeconds: retainedLease.remainingSeconds
          })
        )
      }
      const candidate = state.find((node) => node.node !== primary && node.recovering === false)
      if (
        demotedAt &&
        candidate &&
        (await writerEligibility()).filter((node) => node.status === 200).length === 1
      ) {
        newPrimary = candidate.node
        break
      }
      await new Promise((resolve) => setTimeout(resolve, policy.pollMs))
    }
    assert.ok(
      demotedAt && newPrimary,
      'Partition did not demote the old primary and elect a replacement within RTO'
    )
    await until(async () => {
      assert.deepEqual(await businessState(database.client, acknowledgedIds), before)
      return true
    })
    const key = randomUUID()
    const written = await until(async () => {
      const result = await create(key)
      return result.status === 200 ? result : undefined
    })
    const recoveryMs = performance.now() - started
    assert.ok(recoveryMs <= policy.rtoMs)
    const replayRecovery = await recoverOriginalKey({
      request: () => replay(key), orderId: written.value.orderId,
      deadlineMs: deadline, pollMs: policy.pollMs
    })
    const replayRecoveryMs = performance.now() - started
    assert.ok(replayRecoveryMs <= policy.rtoMs)
    const [order] = await businessState(database.client, [written.value.orderId])
    assert.ok(order.snapshot && order.shipping)
    assert.equal(order.idempotencyOrderRows.length, 1)
    assert.equal(order.reservationOrderRows.length, 1)
    assert.equal(order.eventOrderRows.length, 1)
    assert.equal(order.inventoryOrderRows.length, 1)
    assert.equal(await database.client.order.count({ where: { listingId: order.listingId } }), 1)
    await docker('network', 'connect', '--ip', originalIp, '--alias', primary, network, container)
    disconnected = false
    await until(async () => {
      const state = await Promise.all(nodes.map(readState))
      return (
        state.filter((node) => node.recovering === false).length === 1 &&
        state.find((node) => node.node === primary).recovering === true &&
        (await database.client.$queryRaw`SELECT state FROM pg_stat_replication`).filter(
          (row) => row.state === 'streaming'
        ).length === 2
      )
    })
    assert.deepEqual(await businessState(database.client, acknowledgedIds), before)
    return {
      isolatedPrimary: primary,
      newPrimary,
      preFaultSync: initialSync,
      oldPrimaryLeaseRemainingSecondsAtSqlDemotion: leaseRemainingAtDemotion,
      verifiedSqlDemotionMs: demotedAt,
      recoveryToVerifiedWriteMs: recoveryMs,
      recoveryToVerifiedReplayMs: replayRecoveryMs,
      originalKeyReplayRecovery: replayRecovery,
      confirmedOrdersPreserved: acknowledgedIds.length,
      sameKeyReplayVerified: true,
      oldPrimaryRejoinedAsReplica: true,
      samples
    }
  } catch (error) {
    await writeFile(
      new URL('../.tmp/postgres-ha-auto-partition-failure.json', import.meta.url),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          primary,
          initialSync,
          finalSync: await syncState(compose, leaderKey),
          samples
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    )
    throw error
  } finally {
    if (disconnected)
      await docker('network', 'connect', '--ip', originalIp, '--alias', primary, network, container)
  }
}
