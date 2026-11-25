import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const zh = JSON.parse(await readFile(new URL('../../messages/zh-CN.json', import.meta.url), 'utf8'))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Uses the existing full-browser account/wallet setup. No application API interception.
export async function checkProxyRetry({ buyer, fixture: f, gate, evidence, result }) {
  const listingId = f.listings[0],
    accountId = f.accounts.buyer.id
  const section = buyer.locator('section').filter({
    has: buyer.getByRole('button', { name: '使用 BZTEST 测试托管购买', exact: true })
  })
  const button = section.getByRole('button', { name: '使用 BZTEST 测试托管购买', exact: true })
  const purchase = (response) =>
    new URL(response.url()).pathname === '/api/web3/orders' &&
    response.request().method() === 'POST'
  const proof = (result.proxyRetry = {
    status: 'running',
    fault: 'test-only loopback HTTP gate; Next proxy generates transport 502',
    persistence: 'fresh Prisma connection per snapshot; real isolated PostgreSQL',
    attempts: [],
    snapshots: [],
    gateAttempts: gate.attempts
  })
  const save = async () => {
    if (evidence)
      await writeFile(join(evidence, 'proxy-retry.json'), JSON.stringify(proof, null, 2))
  }
  let key, body
  const snapshot = async (phase) => {
    // A new connection observes committed PG state, independent of the fixture's client.
    const data = await f.db.read((client) =>
      client.$transaction(
        async (tx) => {
          const orders = await tx.order.findMany({
            where: { listingId },
            select: {
              id: true,
              buyerId: true,
              settlementMode: true
            }
          })
          const orderIds = orders.map((row) => row.id)
          return {
            orders,
            inventory: await tx.digitalInventory.findUniqueOrThrow({
              where: { listingId },
              select: {
                listingId: true,
                availability: true,
                activeOrderId: true,
                version: true
              }
            }),
            stocks: await tx.testnetStock.findMany({ where: { listingId } }),
            terms: await tx.paymentOrderTerms.findMany({
              where: { listingId },
              select: {
                orderId: true,
                initialIntentId: true,
                stockId: true
              }
            }),
            intents: await tx.paymentIntent.findMany({
              where: { orderId: { in: orderIds } },
              select: {
                id: true,
                orderId: true
              }
            }),
            idempotency: await tx.idempotencyRecord.findMany({
              where: { actorId: accountId, operation: 'create', ...(key ? { key } : {}) },
              select: {
                key: true,
                operation: true,
                resourceId: true,
                resultCode: true,
                requestHash: true
              }
            }),
            createEvents: await tx.orderEvent.findMany({
              where: { orderId: { in: orderIds }, operation: 'create' },
              select: { orderId: true, requestId: true }
            })
          }
        },
        { isolationLevel: 'RepeatableRead' }
      )
    )
    proof.snapshots.push({ phase, observedAt: new Date().toISOString(), ...data })
    await save()
    return data
  }
  const baseline = await snapshot('before-fault')
  assert.equal(baseline.orders.length, 0)
  assert.equal(baseline.inventory.availability, 'available')
  assert.equal(baseline.inventory.activeOrderId, null)
  assert.equal(baseline.stocks.length, 0)
  assert.equal(baseline.idempotency.length, 0)

  async function failedClick(mode) {
    gate.arm(mode)
    const [response] = await Promise.all([buyer.waitForResponse(purchase), button.click()])
    const request = response.request(),
      requestBody = request.postDataJSON()
    const requestKey = request.headers()['idempotency-key']
    if (!key) {
      key = requestKey
      body = requestBody
    }
    assert.match(requestKey, uuid)
    assert.equal(requestKey, key)
    assert.deepEqual(requestBody, body)
    assert.equal(requestBody.listingId, listingId)
    const data = await response.json(),
      headers = response.headers()
    proof.attempts.push({
      mode,
      key: requestKey,
      body: requestBody,
      status: response.status(),
      data,
      proxyRequestId: headers['x-proxy-request-id'],
      statusSource: headers['x-status-source']
    })
    await save()
    assert.equal(response.status(), 502)
    assert.deepEqual(data, {
      code: 'UNAVAILABLE',
      retryable: true,
      requestId: headers['x-proxy-request-id']
    })
    assert.match(data.requestId, uuid)
    assert.equal(headers['x-request-id'], data.requestId)
    assert.equal(headers['x-status-source'], 'proxy')
    assert.equal(headers['x-application-request-id'], undefined)
    const alert = section.getByRole('alert')
    await alert.waitFor()
    assert.equal(await alert.textContent(), zh.apiErrors.UNAVAILABLE)
    const visible = await buyer.locator('body').innerText()
    for (const privateText of [
      data.requestId,
      'UNAVAILABLE',
      'ECONNRESET',
      'fetch failed',
      gate.origin,
      f.backendOrigin
    ])
      assert.equal(
        visible.includes(privateText),
        false,
        'Diagnostic leaked into visible UI: ' + privateText
      )
    await buyer.getByRole('button', { name: 'T09 buyer · 退出登录', exact: true }).waitFor()
    assert.equal(
      await button.isEnabled(),
      true,
      'Account remains in client store; explicit retry enabled'
    )
    assert.ok(new URL(buyer.url()).pathname.endsWith('/listing/' + listingId))
    // A real session lookup independently confirms the same authenticated account.
    const session = await buyer.evaluate(async () => {
      const r = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
      const data = await r.json()
      return { status: r.status, accountId: data.account?.id }
    })
    assert.deepEqual(session, { status: 200, accountId })
    proof.attempts.at(-1).session = session
    if (evidence) await buyer.screenshot({ path: join(evidence, mode + '.png'), fullPage: true })
    // Check both browser and gate counts across a bounded idle period: recovery is explicit.
    const count = gate.attempts.length
    let unsolicited = 0
    const watch = (r) => {
      if (new URL(r.url()).pathname === '/api/web3/orders') unsolicited++
    }
    buyer.on('request', watch)
    try {
      await buyer.waitForTimeout(1000)
    } finally {
      buyer.off('request', watch)
    }
    assert.equal(unsolicited, 0, 'No automatic browser retry during observation window')
    assert.equal(gate.attempts.length, count)
    proof.attempts.at(-1).noAutomaticRetryObservedMs = 1000
    await save()
  }
  await failedClick('disconnect-before-forward')
  assert.deepEqual(await snapshot('unreachable-no-commit'), baseline)
  await failedClick('disconnect-after-commit')
  const committed = await snapshot('committed-response-lost')
  function assertOne(data, orderId) {
    assert.equal(data.orders.length, 1)
    assert.deepEqual(data.orders[0], {
      id: orderId,
      buyerId: accountId,
      settlementMode: 'testnet_escrow'
    })
    assert.equal(data.inventory.availability, 'reserved')
    assert.equal(data.inventory.activeOrderId, orderId)
    assert.equal(data.inventory.version, baseline.inventory.version + 1)
    assert.equal(data.stocks.length, 1)
    assert.equal(data.stocks[0].state, 'reserved')
    assert.equal(data.stocks[0].activeOrderId, orderId)
    assert.equal(data.terms.length, 1)
    assert.equal(data.terms[0].orderId, orderId)
    assert.deepEqual(data.intents, [{ id: data.terms[0].initialIntentId, orderId }])
    assert.equal(data.idempotency.length, 1)
    assert.equal(data.idempotency[0].key, key)
    assert.equal(data.idempotency[0].resourceId, orderId)
    assert.equal(data.idempotency[0].resultCode, 'OK')
    assert.deepEqual(data.createEvents, [{ orderId, requestId: key }])
  }
  const lost = gate.attempts.at(-1)
  assert.equal(
    lost.upstreamStatus,
    200,
    'Response loss must occur after successful real backend commit'
  )
  assert.match(lost.committedOrderId, uuid)
  assertOne(committed, lost.committedOrderId)
  const [recovered] = await Promise.all([buyer.waitForResponse(purchase), button.click()])
  assert.equal(recovered.status(), 200)
  assert.equal(recovered.headers()['x-status-source'], 'application')
  assert.match(recovered.headers()['x-application-request-id'], uuid)
  assert.equal(recovered.request().headers()['idempotency-key'], key)
  assert.deepEqual(recovered.request().postDataJSON(), body)
  const data = await recovered.json()
  assert.equal(data.orderId, lost.committedOrderId)
  await buyer.waitForURL('**/me/orders/' + data.orderId)
  proof.attempts.push({
    mode: 'explicit-ui-retry',
    status: 200,
    key,
    orderId: data.orderId,
    proxyRequestId: recovered.headers()['x-proxy-request-id'],
    applicationRequestId: recovered.headers()['x-application-request-id']
  })
  assertOne(await snapshot('explicit-retry-recovered'), data.orderId)
  // Repeat the identical browser-origin HTTP command after successful UI navigation.
  const replay = await buyer.evaluate(
    async ({ key, body }) => {
      const session = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }).then((r) => r.json())
      const r = await fetch('/api/web3/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrfToken,
          'Idempotency-Key': key
        },
        body: JSON.stringify(body)
      })
      const data = await r.json()
      return { status: r.status, orderId: data.orderId }
    },
    { key, body }
  )
  assert.deepEqual(replay, { status: 200, orderId: data.orderId })
  proof.attempts.push({ mode: 'browser-fetch-replay', key, ...replay })
  const final = await snapshot('post-success-replay')
  assertOne(final, data.orderId)
  assert.deepEqual(final, committed, 'No second order, intent, stock mutation or create event')
  assert.deepEqual(
    gate.attempts.map((r) => r.mode),
    ['disconnect-before-forward', 'disconnect-after-commit', 'forward', 'forward']
  )
  assert.ok(gate.attempts.every((r) => r.key === key))
  for (const attempt of proof.attempts.slice(0, 3)) {
    const telemetry = result.proxyRequests.find(
      (row) => row.proxyRequestId === attempt.proxyRequestId
    )
    assert.ok(telemetry, 'Real Next proxy telemetry must correlate to the browser response')
    assert.equal(telemetry.status, attempt.status)
  }
  const firstProxyId = proof.attempts[0].proxyRequestId
  assert.equal(
    result.serverRequests.some((row) => row.proxyRequestId === firstProxyId),
    false
  )
  assert.ok(
    result.serverRequests.some(
      (row) => row.proxyRequestId === lost.proxyRequestId && row.status === 200
    )
  )
  // Later full-browser purchases also cross the gate; freeze this supplement's four attempts.
  proof.gateAttempts = gate.attempts.map((row) => ({ ...row }))
  proof.telemetryCorrelated = true
  proof.orderId = data.orderId
  proof.status = 'passed'
  await save()
  return data.orderId
}
