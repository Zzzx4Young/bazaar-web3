import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { startOrderExpiry } from '../dist/orders/order-expiry.js'
import { capacityExpiry, capacityExpiryPolicy } from '../scripts/capacity-expiry.mjs'
import { sandbox } from './helpers/database.mjs'

test('expiry fixtures reject a development database before writing data', async () => {
  let writes = 0
  const workload = capacityExpiry({
    client: {
      $queryRaw: async () => [{ schema: 'bazaar', database: 'bazaar_dev' }],
      listing: { createMany: async () => { writes++ } }
    },
    buyer: { id: randomUUID() }, sellerId: randomUUID(), create: async () => {}
  })
  await assert.rejects(workload.prepare(), { code: 'ERR_ASSERTION' })
  assert.equal(writes, 0)
})

test('failed expiry preparation removes its temporary trigger and function', async () => {
  const db = await sandbox()
  try {
    const buyer = await db.client.account.create({ data: { loginName: 'fixture-buyer', displayName: 'Fixture buyer' } })
    const seller = await db.client.account.create({ data: { loginName: 'fixture-seller', displayName: 'Fixture seller' } })
    const workload = capacityExpiry({ client: db.client, buyer, sellerId: seller.id, count: 1,
      create: async () => { throw new Error('Injected fixture creation failure') } })
    await workload.prepare()
    await assert.rejects(workload.arm(), /Injected fixture creation failure/)
    const triggers = await db.client.$queryRaw`SELECT trigger_name FROM information_schema.triggers
      WHERE trigger_schema = current_schema() AND trigger_name = 'capacity_expiry_insert'`
    const functions = await db.client.$queryRaw`SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = current_schema() AND routine_name = 'capacity_expiry_insert'`
    assert.equal(triggers.length, 0)
    assert.equal(functions.length, 0)
    assert.equal(await db.client.order.count(), 0)
  } finally {
    await db.close()
  }
})

test('expiry workload uses HTTP orders and audits two concurrent test schedulers; not a timed capacity test', async () => {
  const db = await sandbox()
  const origin = 'http://localhost:3000', password = randomUUID()
  let app, workload
  const stops = []
  try {
    await provisionAccounts(db.client, ['expiry-buyer', 'expiry-seller'].map(loginName =>
      ({ loginName, displayName: loginName, password })))
    app = await createApp(readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin }), false)
    await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`
    const login = await fetch(base + '/api/auth/login', { method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ loginName: 'expiry-buyer', password }) })
    assert.equal(login.status, 200)
    const session = await login.json()
    const buyer = { id: session.account.id }
    const seller = await db.client.account.findUniqueOrThrow({ where: { loginName: 'expiry-seller' } })
    workload = capacityExpiry({ client: db.client, buyer, sellerId: seller.id, count: 5,
      create: async (payload, user, key) => {
        assert.equal(user.id, buyer.id)
        const response = await fetch(base + '/api/orders', { method: 'POST',
          headers: { origin, 'content-type': 'application/json',
            cookie: login.headers.getSetCookie()[0].split(';')[0],
            'x-csrf-token': session.csrfToken, 'idempotency-key': key },
          body: JSON.stringify(payload) })
        return { status: response.status, value: await response.json() }
      } })
    await workload.prepare()
    assert.equal(await db.client.order.count(), 0)
    await workload.arm()
    const triggers = await db.client.$queryRaw`SELECT trigger_name FROM information_schema.triggers
      WHERE trigger_schema = current_schema() AND trigger_name = 'capacity_expiry_insert'`
    assert.equal(triggers.length, 0)
    assert.equal(await db.client.order.count({ where: { status: 'pending_payment' } }), 5)
    await assert.rejects(db.client.order.updateMany({ data: { createdAt: new Date() } }), /immutable order identity/)
    workload.start(performance.now())
    // Only this functional test shortens the scheduler cadence/batch; capacity
    // mode retains the normal API process startup schedule and policy.
    for (let i = 0; i < 2; i++) stops.push(startOrderExpiry(db.client, { intervalMs: 10, batchSize: 2 }))
    await new Promise(resolve => setTimeout(resolve, capacityExpiryPolicy.pollMs * 2))
    await workload.stop()
    const evidence = await workload.audit(2)
    assert.equal(evidence.verified, true)
    assert.equal(evidence.releasedPhysicalItems, 5)
    const order = await db.client.order.findFirstOrThrow()
    await db.client.physicalInventory.update({ where: { listingId: order.listingId },
      data: { version: { increment: 1 } } })
    await assert.rejects(workload.audit(2), error => error.code === 'ERR_ASSERTION')
  } finally {
    stops.forEach(stop => stop())
    await workload?.stop()
    await app?.close()
    await db.close()
  }
})
