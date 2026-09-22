import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { sandbox, shipping } from './helpers/database.mjs'

let db, app
const origin = 'http://localhost:3000'
const password = 'V2-Review-Test-Password'
const auth = {}
const post = (actor, path, payload = {}, key) => app.inject({
  method: 'POST',
  url: `/api${path}`,
  headers: { origin, ...auth[actor], ...(key ? { 'idempotency-key': key } : {}) },
  payload
})

before(async () => {
  db = await sandbox()
  await provisionAccounts(db.client, ['seller', 'buyer', 'stranger'].map((name) => ({
    loginName: `review_${name}`, displayName: name, password
  })))
  app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false)
  for (const name of ['seller', 'buyer', 'stranger']) {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin },
      payload: { loginName: `review_${name}`, password }
    })
    assert.equal(response.statusCode, 200, response.body)
    auth[name] = {
      cookie: response.headers['set-cookie'].split(';')[0],
      'x-csrf-token': response.json().csrfToken
    }
  }
})
after(async () => { await app?.close(); await db?.close() })

test('completed buyer review is immutable, scoped, and reflected in public reputation', async () => {
  const listing = await post('seller', '/listings', {
    type: 'physical', title: 'Reviewable item', description: 'Review fixture',
    category: 'electronics', price: { amount: '5.00', currency: 'USD' }
  })
  assert.equal(listing.statusCode, 201, listing.body)
  const sellerId = listing.json().seller.id
  const profile = () => post('stranger', `/sellers/${sellerId}/profile`)
  assert.deepEqual((await profile()).json().reputation, { rating: null, ratingCount: 0 })
  const created = await post('buyer', '/orders', {
    listingId: listing.json().id, version: 1, shipping
  }, randomUUID())
  assert.equal(created.statusCode, 200, created.body)
  const orderId = created.json().orderId
  const act = (actor, action, payload = {}) => post(actor, `/orders/${orderId}/actions/${action}`, payload, randomUUID())
  assert.equal((await post('buyer', `/orders/${orderId}/review`, { rating: 4 })).statusCode, 409)
  assert.equal((await act('buyer', 'pay')).statusCode, 200)
  assert.equal((await act('seller', 'deliver', { carrier: 'Carrier', trackingNumber: 'TEST' })).statusCode, 200)
  assert.equal((await act('buyer', 'accept', { confirmed: true })).statusCode, 200)
  assert.equal((await post('stranger', `/orders/${orderId}/review`, { rating: 5 })).statusCode, 403)
  assert.equal((await post('seller', `/orders/${orderId}/review`, { rating: 5 })).statusCode, 403)
  assert.equal((await post('buyer', `/orders/${orderId}/review`, { rating: 6 })).statusCode, 400)
  assert.equal((await post('buyer', `/orders/${orderId}/review`, { rating: 4 })).statusCode, 200)
  assert.equal((await post('buyer', `/orders/${orderId}/review`, { rating: 4 })).statusCode, 200)
  assert.equal((await post('buyer', `/orders/${orderId}/review`, { rating: 2 })).statusCode, 409)
  assert.deepEqual((await profile()).json().reputation, { rating: '4.00', ratingCount: 1 })
  assert.equal((await post('buyer', `/orders/${orderId}`)).json().review.rating, 4)
  assert.equal(await db.client.sellerReview.count({ where: { orderId } }), 1)
  await assert.rejects(db.client.sellerReview.update({
    where: { orderId }, data: { rating: 1 }
  }), /immutable history/)
})
