import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { sandbox, shipping } from './helpers/database.mjs'
import { connect, testUrl } from './helpers/database.mjs'
import { grantRuntime } from '../scripts/runtime-grants.mjs'
import { readFile } from 'node:fs/promises'
import Ajv from 'ajv'

test('I4 HTTP: participant privacy, query pagination and command replay', async () => {
  const db = await sandbox()
  const admin = await connect(testUrl())
  const role = `http_${randomUUID().replaceAll('-', '')}`
  let roleCreated = false
  let app
  try {
    const origin = 'http://localhost:3000'
    const password = 'Order-http-fixture-password'
    await provisionAccounts(
      db.client,
      ['seller', 'buyer', 'outsider'].map((loginName) => ({
        loginName,
        displayName: loginName,
        password
      }))
    )
    const secret = randomUUID()
    await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${secret}'`)
    roleCreated = true
    await grantRuntime(db.client, db.schema, role)
    const runtimeUrl = new URL(db.url)
    runtimeUrl.username = role
    runtimeUrl.password = secret
    app = await createApp(readConfig({ DATABASE_URL: runtimeUrl.toString() }), false)
    const api = JSON.parse(
      await readFile(new URL('../../docs/openapi/alpha.json', import.meta.url), 'utf8')
    )
    const ajv = new Ajv({ strict: false, validateFormats: false })
    ajv.addSchema({ components: api.components }, 'alpha')
    const contract = (name, value) => {
      const validate = ajv.compile({ $ref: `alpha#/components/schemas/${name}` })
      assert.equal(validate(value), true, JSON.stringify(validate.errors))
    }
    const post = (url, headers, payload = {}) =>
      app.inject({ method: 'POST', url: `/api${url}`, headers, payload })
    const accounts = {}
    for (const loginName of ['seller', 'buyer', 'outsider']) {
      const response = await post('/auth/login', { origin }, { loginName, password })
      assert.equal(response.statusCode, 200)
      accounts[loginName] = {
        origin,
        cookie: response.headers['set-cookie'].split(';')[0],
        'x-csrf-token': response.json().csrfToken
      }
    }
    const listing = await post('/listings', accounts.seller, {
      type: 'physical',
      title: 'Private order fixture',
      description: 'Public description',
      category: 'test',
      price: { amount: '12.50', currency: 'USD' }
    })
    assert.equal(listing.statusCode, 201)
    const payload = { listingId: listing.json().id, version: 1, shipping }
    const headers = { ...accounts.buyer, 'idempotency-key': randomUUID() }
    const created = await post('/orders', headers, payload)
    assert.equal(created.statusCode, 200, created.body)
    const id = created.json().orderId
    assert.deepEqual((await post('/orders', headers, payload)).json(), { orderId: id })
    assert.equal((await post('/orders', headers, { ...payload, version: 2 })).statusCode, 409)
    assert.equal(await db.client.order.count(), 1)
    for (const suffix of ['', '/deliveries', '/issues', '/refunds', '/settlements', '/events']) {
      for (const actor of ['buyer', 'seller']) {
        const response = await post(`/orders/${id}${suffix}`, accounts[actor])
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.headers['cache-control'], 'no-store')
      }
      const hidden = await post(`/orders/${id}${suffix}`, accounts.outsider)
      const absent = await post(`/orders/${randomUUID()}${suffix}`, accounts.outsider)
      assert.equal(hidden.statusCode, 404)
      assert.deepEqual(hidden.json(), absent.json())
      assert.equal((await post(`/orders/${id}${suffix}`, { origin })).statusCode, 401)
    }
    assert.deepEqual((await post(`/orders/${id}`, accounts.buyer)).json().shipping, shipping)
    const summary = await post('/orders/search?page=1&limit=1&role=buyer', accounts.buyer)
    assert.equal(summary.statusCode, 200, summary.body)
    assert.deepEqual(summary.json().items[0].price, { amount: '12.5', currency: 'USD' })
    assert.equal(summary.body.includes(shipping.address), false)
    assert.equal((await post('/orders/search', accounts.outsider)).json().items.length, 0)
    assert.equal(
      (await post('/orders/search?page=2&limit=1', accounts.buyer)).json().items.length,
      0
    )
    for (const query of ['page=0', 'page=1.5', 'limit=51', 'status=unknown', 'role=unknown'])
      assert.equal((await post(`/orders/search?${query}`, accounts.buyer)).statusCode, 400)
    assert.equal(
      (await post(`/orders/${id}/events?page=1&limit=1`, accounts.buyer)).statusCode,
      200
    )
    assert.equal(
      (
        await post(`/orders/${id}/actions/pay`, {
          ...accounts.outsider,
          'idempotency-key': randomUUID()
        })
      ).statusCode,
      404
    )
    assert.equal(
      (
        await post(`/orders/${id}/actions/pay`, {
          ...accounts.seller,
          'idempotency-key': randomUUID()
        })
      ).statusCode,
      403
    )
    const payHeaders = { ...accounts.buyer, 'idempotency-key': randomUUID() }
    const noCsrf = { ...payHeaders }
    delete noCsrf['x-csrf-token']
    assert.equal(
      (await post(`/orders/${id}/actions/pay?bypass=/auth/session`, noCsrf)).statusCode,
      403
    )
    assert.equal(await db.client.settlementRecord.count(), 0)
    assert.equal((await post(`/orders/${id}/actions/pay`, payHeaders)).statusCode, 200)
    assert.equal((await post(`/orders/${id}/actions/pay`, payHeaders)).statusCode, 200)
    assert.equal(await db.client.settlementRecord.count(), 1)
    const act = (actor, orderId, action, body = {}, key = randomUUID()) =>
      post(
        `/orders/${orderId}/actions/${action}`,
        { ...accounts[actor], 'idempotency-key': key },
        body
      )
    assert.equal((await act('buyer', id, 'accept', {})).statusCode, 400)
    assert.equal((await act('buyer', id, 'pay', { actorId: 'forged' })).statusCode, 400)
    assert.equal((await act('seller', id, 'deliver', { reference: 'legacy' })).statusCode, 400)
    const delivered = await act('seller', id, 'deliver', {
      carrier: 'Fixture carrier',
      trackingNumber: 'private-tracking'
    })
    assert.equal(delivered.statusCode, 200, delivered.body)
    assert.equal(
      (await act('buyer', id, 'issue', { description: 'Fixture issue' })).statusCode,
      200
    )
    assert.equal((await act('buyer', id, 'request-refund')).statusCode, 200)
    assert.equal(
      (
        await act('seller', id, 'deliver', {
          carrier: 'Fixture carrier',
          trackingNumber: 'replacement'
        })
      ).statusCode,
      200
    )
    assert.equal((await post(`/orders/${id}`, accounts.buyer)).json().status, 'issue')
    assert.equal((await act('seller', id, 'refund', { returnOutcome: 'returned' })).statusCode, 200)
    const restoreKey = randomUUID()
    assert.equal(
      (await act('seller', id, 'restore', { inHandAndResellable: true }, restoreKey)).statusCode,
      200
    )
    for (const [suffix, name] of [
      ['', 'OrderDetail'],
      ['/deliveries', 'DeliveryPage'],
      ['/issues', 'IssuePage'],
      ['/refunds', 'RefundPage'],
      ['/settlements', 'SettlementPage'],
      ['/events', 'EventPage']
    ]) {
      const response = await post(`/orders/${id}${suffix}`, accounts.buyer)
      contract(name, response.json())
      assert.equal((await post(`/orders/${id}${suffix}`, accounts.outsider)).statusCode, 404)
    }
    contract('OrderSummaryPage', (await post('/orders/search', accounts.buyer)).json())
    const raced = await Promise.all(
      ['buyer', 'outsider'].map((actor) =>
        post('/orders', { ...accounts[actor], 'idempotency-key': randomUUID() }, payload)
      )
    )
    assert.deepEqual(raced.map((r) => r.statusCode).sort(), [200, 409])
    const winner = raced.findIndex((r) => r.statusCode === 200)
    const nextId = raced[winner].json().orderId
    const nextActor = ['buyer', 'outsider'][winner]
    assert.equal(
      (await act('seller', id, 'restore', { inHandAndResellable: true }, restoreKey)).statusCode,
      200
    )
    assert.equal(
      (
        await db.client.physicalInventory.findUniqueOrThrow({
          where: { listingId: payload.listingId }
        })
      ).activeOrderId,
      nextId
    )
    const competing = await Promise.all(
      ['pay', 'cancel'].map((action) => act(nextActor, nextId, action))
    )
    assert.deepEqual(competing.map((r) => r.statusCode).sort(), [200, 409])
    const digital = await post('/listings', accounts.seller, {
      type: 'digital',
      title: 'Digital fixture',
      description: 'Public digital description',
      category: 'test',
      price: { amount: '1', currency: 'USD' },
      licenseDescription: 'Fixture license',
      contentVersion: '1'
    })
    const digitalInput = { listingId: digital.json().id, version: 1 }
    assert.equal(
      (
        await post(
          '/orders',
          { ...accounts.buyer, 'idempotency-key': randomUUID() },
          { ...digitalInput, shipping }
        )
      ).statusCode,
      400
    )
    const digitalOrder = (
      await post('/orders', { ...accounts.buyer, 'idempotency-key': randomUUID() }, digitalInput)
    ).json().orderId
    assert.equal((await act('buyer', digitalOrder, 'pay')).statusCode, 200)
    for (const url of [
      'http://example.test',
      'https://user:pass@example.test',
      'javascript:alert(1)'
    ])
      assert.equal((await act('seller', digitalOrder, 'deliver', { url })).statusCode, 400)
    const deliveryKey = randomUUID()
    const delivery = { url: 'https://example.test/private-download', accessCode: 'secret-code' }
    assert.equal(
      (await act('seller', digitalOrder, 'deliver', delivery, deliveryKey)).statusCode,
      200
    )
    assert.equal(
      (
        await act(
          'seller',
          digitalOrder,
          'deliver',
          { ...delivery, accessCode: 'changed' },
          deliveryKey
        )
      ).statusCode,
      409
    )
    const privateDelivery = await post(`/orders/${digitalOrder}/deliveries`, accounts.buyer)
    contract('DeliveryPage', privateDelivery.json())
    assert.equal(privateDelivery.json().items[0].accessCode, delivery.accessCode)
    assert.equal(
      (await post(`/orders/${digitalOrder}/deliveries`, accounts.outsider)).statusCode,
      404
    )
    assert.equal((await post('/listings/search', { origin })).body.includes('secret-code'), false)
    assert.equal(
      (await act('buyer', digitalOrder, 'issue', { description: 'Digital issue' })).statusCode,
      200
    )
    assert.equal((await act('buyer', digitalOrder, 'request-refund')).statusCode, 200)
    const finalRace = await Promise.all([
      act('buyer', digitalOrder, 'accept', { confirmed: true }),
      act('seller', digitalOrder, 'refund')
    ])
    assert.deepEqual(finalRace.map((r) => r.statusCode).sort(), [200, 409])
    for (const outcome of ['accept', 'refund']) {
      const orderId = (
        await post('/orders', { ...accounts.buyer, 'idempotency-key': randomUUID() }, digitalInput)
      ).json().orderId
      assert.equal((await act('buyer', orderId, 'pay')).statusCode, 200)
      assert.equal((await act('seller', orderId, 'deliver', delivery)).statusCode, 200)
      if (outcome === 'refund') {
        assert.equal(
          (await act('buyer', orderId, 'issue', { description: 'Refund case' })).statusCode,
          200
        )
        assert.equal((await act('buyer', orderId, 'request_refund')).statusCode, 400)
        assert.equal((await act('buyer', orderId, 'request-refund')).statusCode, 200)
      }
      assert.equal(
        (
          await act(
            outcome === 'accept' ? 'buyer' : 'seller',
            orderId,
            outcome,
            outcome === 'accept' ? { confirmed: true } : {}
          )
        ).statusCode,
        200
      )
      const result = await post(`/orders/${orderId}`, accounts.buyer)
      contract('OrderDetail', result.json())
      assert.equal(result.json().status, outcome === 'accept' ? 'completed' : 'refunded')
      assert.equal(result.json().shipping, null)
    }
  } finally {
    await app?.close()
    await db.close()
    if (roleCreated) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})
