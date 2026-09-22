import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import Ajv from 'ajv'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { sandbox, shipping } from './helpers/database.mjs'

let db, app
const origin = 'http://localhost:3000'
const password = 'V2-Cart-HTTP-Password'
const auth = {}
const post = (actor, path, payload = {}, key) => app.inject({
  method: 'POST', url: `/api${path}`,
  headers: { origin, ...auth[actor], ...(key ? { 'idempotency-key': key } : {}) }, payload
})

before(async () => {
  db = await sandbox()
  await provisionAccounts(db.client, ['seller1', 'seller2', 'buyer', 'outsider'].map((name) => ({
    loginName: `cart_${name}`, displayName: name, password
  })))
  app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false)
  for (const name of ['seller1', 'seller2', 'buyer', 'outsider']) {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin },
      payload: { loginName: `cart_${name}`, password }
    })
    assert.equal(response.statusCode, 200, response.body)
    auth[name] = {
      cookie: response.headers['set-cookie'].split(';')[0],
      'x-csrf-token': response.json().csrfToken
    }
  }
})
after(async () => { await app?.close(); await db?.close() })

test('HTTP cart enforces ownership, atomic validation, and published response contracts', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  const ajv = new Ajv({ strict: false, validateFormats: false })
  ajv.addSchema({ components: api.components }, 'alpha')
  const validate = (name, value) => {
    const check = ajv.compile({ $ref: `alpha#/components/schemas/${name}` })
    assert.equal(check(value), true, JSON.stringify(check.errors))
  }
  const listing = async (actor, type, currency) => {
    const result = await post(actor, '/listings', {
      type, title: `${actor} ${type}`, description: 'Cart fixture', category: 'electronics',
      price: { amount: '12.50', currency },
      ...(type === 'digital' ? { licenseDescription: 'Review license', contentVersion: 'v1' } : {})
    })
    assert.equal(result.statusCode, 201, result.body)
    return result.json()
  }
  const physical = await listing('seller1', 'physical', 'USD')
  const digital = await listing('seller2', 'digital', 'EUR')
  const items = [
    { listingId: physical.id, version: 1, shipping },
    { listingId: digital.id, version: 1 }
  ]
  assert.equal((await post('buyer', '/checkouts', { items: [items[0]] }, randomUUID())).statusCode, 400)
  assert.equal((await post('buyer', '/checkouts', { items: [items[0], items[0]] }, randomUUID())).statusCode, 400)
  const key = randomUUID()
  const result = await post('buyer', '/checkouts', { items }, key)
  assert.equal(result.statusCode, 200, result.body)
  validate('CheckoutCreateResult', result.json())
  assert.equal((await post('buyer', '/checkouts', { items }, key)).body, result.body)
  assert.equal((await post('buyer', '/checkouts', { items: [...items].reverse() }, key)).statusCode, 409)
  const id = result.json().checkoutId
  assert.equal((await post('outsider', `/checkouts/${id}`)).statusCode, 404)
  assert.equal((await post('seller1', `/checkouts/${id}`)).statusCode, 404)
  const detail = await post('buyer', `/checkouts/${id}`)
  assert.equal(detail.statusCode, 200, detail.body)
  validate('CheckoutDetail', detail.json())
  assert.deepEqual(new Set(detail.json().items.map((item) => item.price.currency)),
    new Set(['USD', 'EUR']))
  for (const orderId of result.json().orderIds) {
    const order = await post('buyer', `/orders/${orderId}`)
    assert.equal(order.statusCode, 200)
    validate('OrderDetail', order.json())
    assert.equal(order.json().checkoutId, id)
  }
  const unavailable = await post('outsider', '/orders', {
    listingId: physical.id, version: 1, shipping
  }, randomUUID())
  assert.equal(unavailable.statusCode, 409)
  assert.equal(unavailable.json().code, 'UNAVAILABLE')
})
