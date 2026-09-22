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
const password = 'V2-Dispute-HTTP-Password'
const names = ['seller', 'buyer', 'admin', 'observer', 'outsider']
const headers = {}
const post = (url, actor, payload = {}, key) => app.inject({
  method: 'POST',
  url: `/api${url}`,
  headers: { ...headers[actor], ...(key ? { 'idempotency-key': key } : {}) },
  payload
})

before(async () => {
  db = await sandbox()
  await provisionAccounts(db.client, names.map((loginName) => ({
    loginName: `v2_${loginName}`,
    displayName: loginName,
    password
  })))
  for (const role of ['admin', 'observer'])
    await db.client.account.update({ where: { loginName: `v2_${role}` }, data: { role } })
  app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false)
  for (const name of names) {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin },
      payload: { loginName: `v2_${name}`, password }
    })
    assert.equal(response.statusCode, 200, response.body)
    headers[name] = {
      origin,
      cookie: response.headers['set-cookie'].split(';')[0],
      'x-csrf-token': response.json().csrfToken
    }
    assert.equal(response.json().account.role, name === 'admin' || name === 'observer' ? name : 'participant')
  }
})
after(async () => { await app?.close(); await db?.close() })

test('HTTP dispute flow enforces roles, hides private data, and updates simulated balances', async () => {
  const api = JSON.parse(await readFile(new URL('../openapi/alpha.json', import.meta.url), 'utf8'))
  const ajv = new Ajv({ strict: false, validateFormats: false })
  ajv.addSchema({ components: api.components }, 'alpha')
  const validate = (schema, value) => {
    const check = ajv.compile({ $ref: `alpha#/components/schemas/${schema}` })
    assert.equal(check(value), true, JSON.stringify(check.errors))
  }
  const listing = await post('/listings', 'seller', {
    type: 'physical', title: 'Dispute HTTP item', description: 'Dispute fixture',
    category: 'electronics', price: { amount: '12.50', currency: 'USD' }
  })
  assert.equal(listing.statusCode, 201, listing.body)
  const created = await post('/orders', 'buyer', {
    listingId: listing.json().id, version: 1, shipping
  }, randomUUID())
  assert.equal(created.statusCode, 200, created.body)
  const id = created.json().orderId
  const act = (actor, action, payload = {}, key = randomUUID()) =>
    post(`/orders/${id}/actions/${action}`, actor, payload, key)
  assert.equal((await act('buyer', 'pay')).statusCode, 200)
  assert.equal((await act('seller', 'deliver', { carrier: 'Carrier', trackingNumber: 'PRIVATE-TRACK' })).statusCode, 200)
  assert.equal((await act('buyer', 'issue', { description: 'Wrong item delivered' })).statusCode, 200)
  assert.equal((await act('buyer', 'request-refund')).statusCode, 200)
  assert.equal((await act('seller', 'counteroffer', { description: 'I can redeliver tomorrow' })).statusCode, 200)
  assert.equal((await act('buyer', 'counteroffer', { description: 'Forged offer' })).statusCode, 403)
  assert.equal((await post('/admin/disputes', 'buyer')).statusCode, 403)
  assert.equal((await post('/admin/disputes', 'observer')).statusCode, 403)
  const list = await post('/admin/disputes', 'admin')
  assert.equal(list.statusCode, 200, list.body)
  validate('AdminDisputePage', list.json())
  assert.ok(list.json().items.some((item) => item.id === id && item.hasCounteroffer))
  const detail = await post(`/admin/disputes/${id}`, 'admin')
  assert.equal(detail.statusCode, 200, detail.body)
  validate('AdminDispute', detail.json())
  assert.equal(detail.json().counteroffer, 'I can redeliver tomorrow')
  assert.equal(detail.body.includes('PRIVATE-TRACK'), false)
  assert.equal(detail.body.includes(shipping.address), false)
  const beforeSeller = await post('/balances', 'seller')
  assert.equal(beforeSeller.statusCode, 200)
  validate('BalancePage', beforeSeller.json())
  assert.equal(beforeSeller.json().items.find((row) => row.currency === 'USD')?.amount, '0')
  assert.equal((await post(`/admin/disputes/${id}/resolve`, 'buyer', { outcome: 'release' }, randomUUID())).statusCode, 403)
  const key = randomUUID()
  const resolution = await post(`/admin/disputes/${id}/resolve`, 'admin', { outcome: 'release' }, key)
  assert.equal(resolution.statusCode, 200, resolution.body)
  validate('CommandResult', resolution.json())
  assert.equal((await post(`/admin/disputes/${id}/resolve`, 'admin', { outcome: 'release' }, key)).statusCode, 200)
  assert.equal((await post(`/admin/disputes/${id}/resolve`, 'admin', { outcome: 'refund', returnOutcome: 'returned' }, key)).statusCode, 409)
  assert.equal((await post(`/orders/${id}`, 'buyer')).json().status, 'completed')
  const afterSeller = await post('/balances', 'seller')
  validate('BalancePage', afterSeller.json())
  assert.equal(afterSeller.json().items.find((row) => row.currency === 'USD')?.amount, '12.5')
  const buyerBalance = await post('/balances', 'buyer')
  assert.equal(buyerBalance.json().items.find((row) => row.currency === 'USD')?.amount, '-12.5')
  const history = await post(`/orders/${id}/events`, 'buyer')
  for (const event of history.json().items) validate('Event', event)
  assert.equal(history.json().items.find((event) => event.operation === 'counteroffer').note, 'I can redeliver tomorrow')
})
