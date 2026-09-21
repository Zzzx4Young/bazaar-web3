import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { sandbox, fixture, race } from './helpers/database.mjs'

let db
before(async () => { db = await sandbox() })
after(async () => { await db?.close() })

test('single digital entitlement is reserved atomically and cannot be bought twice', async () => {
  const f = await fixture(db, 'digital', '12.50')
  await db.client.digitalInventory.create({ data: { listingId: f.listing.id } })
  const attempts = await race(
    db,
    (options) => db.market.create(f.buyer, randomUUID(), f.input, options),
    (options) => db.market.create(f.other, randomUUID(), f.input, options)
  )
  assert.equal(attempts[0].status, 'fulfilled')
  assert.equal(attempts[1].status, 'rejected')
  assert.equal(attempts[1].reason.code, 'UNAVAILABLE')
  const firstOrderId = attempts[0].value
  assert.deepEqual(
    await db.client.digitalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })
      .then(({ availability, activeOrderId }) => ({ availability, activeOrderId })),
    { availability: 'reserved', activeOrderId: firstOrderId }
  )

  await db.market.act(f.buyer, randomUUID(), firstOrderId, 'cancel')
  assert.equal((await db.client.digitalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })).availability, 'available')
  const secondOrderId = await db.market.create(f.other, randomUUID(), f.input)
  await db.market.act(f.other, randomUUID(), secondOrderId, 'pay')
  await db.market.act(f.seller, randomUUID(), secondOrderId, 'deliver', { reference: 'https://example.com/private-key', accessCode: 'ONE-TIME-KEY' })
  await db.market.act(f.other, randomUUID(), secondOrderId, 'accept')
  assert.equal((await db.client.digitalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })).availability, 'sold')
  await assert.rejects(db.market.create(f.buyer, randomUUID(), f.input), (error) => error.code === 'UNAVAILABLE')
})

test('refunded single digital entitlement remains unavailable', async () => {
  const f = await fixture(db, 'digital', '9.75')
  await db.client.digitalInventory.create({ data: { listingId: f.listing.id } })
  const id = await db.market.create(f.buyer, randomUUID(), f.input)
  await db.market.act(f.buyer, randomUUID(), id, 'pay')
  await db.market.act(f.seller, randomUUID(), id, 'deliver', { reference: 'https://example.com/one-key' })
  await db.market.act(f.buyer, randomUUID(), id, 'issue', { description: 'Key did not work' })
  await db.market.act(f.buyer, randomUUID(), id, 'request_refund')
  await db.market.act(f.seller, randomUUID(), id, 'refund')
  assert.equal((await db.client.digitalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } })).availability, 'refund_hold')
  await assert.rejects(db.market.create(f.other, randomUUID(), f.input), (error) => error.code === 'UNAVAILABLE')
})

test('listing API creates single digital stock and defaults other digital listings to unlimited', async () => {
  const password = 'Digital-stock-test-password'
  const name = `seller_${randomUUID()}`
  await provisionAccounts(db.client, [{ loginName: name, displayName: 'Digital seller', password }])
  const app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false)
  try {
    const origin = 'http://localhost:3000'
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { loginName: name, password } })
    assert.equal(login.statusCode, 200, login.body)
    const headers = { origin, cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().csrfToken }
    const payload = {
      type: 'digital', title: 'One license', description: 'One transferable license', category: 'software_source',
      price: { amount: '15', currency: 'USD' }, licenseDescription: 'One use', contentVersion: 'v2'
    }
    const create = (body) => app.inject({ method: 'POST', url: '/api/listings', headers, payload: body })
    const single = await create({ ...payload, supplyMode: 'single' })
    assert.equal(single.statusCode, 201, single.body)
    assert.equal(single.json().availability, 'available')
    assert.equal(await db.client.digitalInventory.count({ where: { listingId: single.json().id } }), 1)
    const unlimited = await create(payload)
    assert.equal(unlimited.statusCode, 201, unlimited.body)
    assert.equal(unlimited.json().availability, 'unlimited')
    assert.equal(await db.client.digitalInventory.count({ where: { listingId: unlimited.json().id } }), 0)
    assert.equal((await create({ ...payload, supplyMode: 'many' })).statusCode, 400)
    assert.equal((await create({ ...payload, type: 'physical', supplyMode: 'single' })).statusCode, 400)
  } finally {
    await app.close()
  }
})
