import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export async function checkGatewayFailure({
  project, compose, address, apis, children, post, until, policy,
  session, buyerId, database, businessState, ids, before, create
}) {
  const gateways = ['writer', 'writer2']
  const endpoints = await Promise.all(gateways.map((name) => address(name, 5432)))
  assert.notEqual(endpoints[0], endpoints[1])
  const acknowledged = [...ids]
  const observations = []
  for (let index = 0; index < gateways.length; index++) {
    const prior = await businessState(database.client, acknowledged)
    const previouslyAcknowledged = [...acknowledged]
    const failedApi = apis[index]
    const survivor = apis[1 - index]
    const started = performance.now()
    await compose('kill', '-s', 'SIGKILL', gateways[index])
    await until(async () => (await post(failedApi, '/api/health/ready')).status === 503)
    assert.equal((await post(failedApi, '/api/health/live')).status, 200, `${gateways[index]} failure: liveness`)
    assert.equal((await post(survivor, '/api/health/ready')).status, 200, `${gateways[index]} failure: survivor readiness`)
    const listingIndex = policy.orders + index * 2
    const key = randomUUID()
    // Explicit original-key recovery only; no proxy or automatic HTTP write retries.
    assert.equal((await create(listingIndex, key, failedApi)).status, 503)
    const created = await create(listingIndex, key, survivor)
    assert.equal(created.status, 200, `${gateways[index]} failure: survivor create`)
    const orderId = created.value.orderId
    const survivorReplay = await create(listingIndex, key, survivor)
    assert.equal(survivorReplay.status, 200, `${gateways[index]} failure: survivor replay`)
    assert.equal(survivorReplay.value.orderId, orderId)
    const survivorWriteMs = performance.now() - started
    assert.ok(survivorWriteMs <= policy.rtoMs)
    acknowledged.push(orderId)
    const restored = performance.now()
    await compose('start', gateways[index])
    assert.equal(await address(gateways[index], 5432), endpoints[index])
    await until(async () => (await post(failedApi, '/api/health/ready')).status === 200)
    const replay = await create(listingIndex, key, failedApi)
    assert.equal(replay.status, 200, `${gateways[index]} restored: original API replay`)
    assert.equal(replay.value.orderId, orderId)
    const recoveredKey = randomUUID()
    const recovered = await create(listingIndex + 1, recoveredKey, failedApi)
    assert.equal(recovered.status, 200, `${gateways[index]} restored: original API create`)
    acknowledged.push(recovered.value.orderId)
    const recoveryMs = performance.now() - restored
    assert.ok(recoveryMs <= policy.rtoMs)
    assert.equal((await post(failedApi, '/api/auth/session', {}, session)).value.account.id, buyerId)
    assert.ok(children.every((child) => child.exitCode === null && child.signalCode === null))
    assert.deepEqual(await businessState(database.client, ids), before)
    assert.deepEqual(await businessState(database.client, previouslyAcknowledged), prior)
    const rows = await businessState(database.client, acknowledged)
    assert.equal(rows.length, acknowledged.length)
    for (const id of [orderId, recovered.value.orderId]) {
      const row = rows.find((item) => item.id === id)
      assert.equal(row.status, 'pending_payment')
      assert.equal(row.idempotencyOrderRows.length, 1)
      assert.equal(row.reservationOrderRows.length, 1)
      assert.equal(row.inventoryOrderRows.length, 1)
      assert.equal(row.eventOrderRows.length, 1)
      assert.ok(row.snapshot && row.shipping)
    }
    observations.push({ gateway: gateways[index], failedReadinessStatus: 503,
      failedWriteStatus: 503, livenessStatus: 200, survivorWriteMs, recoveryMs,
      originalKeyOrderId: orderId, originalSessionVerified: true,
      originalApiProcessesSurvived: true, databaseEndpointsUnchanged: true })
  }
  assert.equal(await database.client.order.count(), acknowledged.length)
  return { timestamp: new Date().toISOString(), project, verified: true,
    acknowledgedOrders: acknowledged.length, initialOrdersPreserved: ids.length,
    observations, limitations: ['same-host containers', 'no capacity load in this fault run',
      'no host watchdog or external fencing', 'HTTP ingress redundancy not verified'] }
}
