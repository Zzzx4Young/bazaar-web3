import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { currencyCodes } from '../dist/pricing/currencies.js'
import { RatesService } from '../dist/pricing/rates.service.js'
import { sandbox } from './helpers/database.mjs'

const origin = 'http://localhost:3000'
const password = 'Virtual-listing-test-password'
const rateData = () => ({
  data: {
    currency: 'USD',
    rates: {
      ...Object.fromEntries(currencyCodes.map((code) => [code, '1'])),
      CNY: '7',
      BTC: '0.00001',
      ETH: '0.001',
      USDT: '1.01',
      USDC: '0.99'
    }
  }
})
const listing = (currency = 'USD', amount = '2') => ({
  type: 'physical',
  title: 'Virtual listing',
  description: 'Virtual description',
  category: 'test',
  price: { amount, currency }
})

async function login(app, loginName) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { loginName, password }
  })
  assert.equal(response.statusCode, 200, response.body)
  return {
    origin,
    cookie: response.headers['set-cookie'].split(';')[0],
    'x-csrf-token': response.json().csrfToken
  }
}

test('I2: shared listings, ownership, validation, version races, withdrawal and exact USD sorting', async () => {
  const db = await sandbox()
  let app
  let calls = 0
  try {
    await provisionAccounts(
      db.client,
      ['alice', 'bob'].map((loginName) => ({ loginName, displayName: loginName, password }))
    )
    app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false, {
      loadRates: async () => {
        calls++
        return rateData()
      }
    })
    const alice = await login(app, 'alice'),
      bob = await login(app, 'bob')
    const create = (payload) =>
      app.inject({ method: 'POST', url: '/api/listings/search', headers: alice, payload })
    assert.equal((await app.inject({ method: 'POST', url: '/api/currencies', headers: { origin, 'content-type': 'application/json' }, payload: {} })).json().length, 19)
    const created = []
    for (const payload of [
      listing('USD', '2'),
      listing('CNY', '21'),
      listing('BTC', '0.0001'),
      {
        ...listing('ETH', '0.001'),
        type: 'digital',
        licenseDescription: 'Nonexclusive',
        contentVersion: 'v1'
      }
    ]) {
      const response = await create(payload)
      assert.equal(response.statusCode, 201, response.body)
      created.push(response.json())
    }
    assert.equal(await db.client.physicalInventory.count(), 3)
    const list = await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: {}, headers: bob })
    assert.equal(list.json().items.length, 4)
    assert.equal(list.body.includes('loginName'), false)
    assert.equal(list.body.includes('passwordHash'), false)
    for (const payload of [
      { ...listing(), sellerId: randomUUID() },
      listing('TEST'),
      listing('USD', 2),
      listing('JPY', '2.1'),
      listing('BTC', '0.123456789'),
      listing('USD', '0'),
      listing('USD', 'NaN'),
      { ...listing(), type: ['physical'] },
      { ...listing(), title: '   ' },
      { ...listing(), type: 'digital' },
      { ...listing(), licenseDescription: 'unexpected' }
    ])
      assert.equal((await create(payload)).statusCode, 400)
    assert.equal(await db.client.listing.count(), 4)
    assert.equal(await db.client.physicalInventory.count(), 3)
    const first = created[0]
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/listings/${first.id}/edit`,
          headers: bob,
          payload: { version: 1, title: 'forged' }
        })
      ).statusCode,
      403
    )
    const edits = await Promise.all(
      ['one', 'two'].map((title) =>
        app.inject({
          method: 'POST',
          url: `/api/listings/${first.id}/edit`,
          headers: alice,
          payload: { version: 1, title }
        })
      )
    )
    assert.deepEqual(edits.map((response) => response.statusCode).sort(), [200, 409])
    const sorted = await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: { sort: 'price_asc', limit: '2' } })
    assert.equal(sorted.statusCode, 200, sorted.body)
    assert.deepEqual(
      sorted.json().items.map((item) => item.id),
      [created[3].id, created[0].id]
    )
    assert.equal(sorted.json().quote.base, 'USD')
    assert.equal(sorted.json().quote.sourceAsOf, null)
    assert.equal(calls, 1)
    const quote = await db.client.rateSnapshot.findUniqueOrThrow({
      where: { id: sorted.json().quote.id }
    })
    await db.client.rateSnapshot.create({
      data: {
        provider: 'Fixture later snapshot',
        rates: { ...quote.rates, BTC: '1' },
        fetchedAt: new Date(Date.now() + 1),
        expiresAt: new Date(Date.now() + 300000)
      }
    })
    const second = await app.inject({
      method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: { sort: 'price_asc', limit: '2', page: '2', quoteId: quote.id }
    })
    assert.equal(second.statusCode, 200, second.body)
    assert.deepEqual(
      second.json().items.map((item) => item.id),
      [created[1].id, created[2].id]
    )
    assert.equal((await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: { sort: 'price_asc', page: '2' } })).statusCode, 400)
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: { sort: 'price_asc', quoteId: randomUUID() } }))
        .statusCode,
      409
    )
    const stale = await db.client.rateSnapshot.create({
      data: {
        provider: 'Expired fixture',
        rates: quote.rates,
        fetchedAt: new Date(Date.now() - 20000),
        expiresAt: new Date(Date.now() - 10000)
      }
    })
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: { sort: 'price_asc', quoteId: stale.id } })).statusCode,
      409
    )
    const down = await app.inject({
      method: 'POST',
      url: `/api/listings/${first.id}/edit`,
      headers: alice,
      payload: { version: 2, publicationStatus: 'withdrawn' }
    })
    assert.equal(down.statusCode, 200)
    assert.equal((await app.inject({ url: `/api/listings/${first.id}/edit` })).statusCode, 404)
    assert.equal((await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: {} })).json().items.length, 3)
    assert.equal(
      (
        await app.inject({ method: 'POST', url: '/api/me/listings', payload: { publicationStatus: 'withdrawn' }, headers: alice })
      ).json().items.length,
      1
    )
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/me/listings', payload: {}, headers: bob })).json().items.length,
      0
    )
    assert.equal((await app.inject({ method: 'POST', url: '/api/me/listings', payload: {} })).statusCode, 401)
  } finally {
    await app?.close()
    await db.close()
  }
})

test('I2: invalid rates fail closed; provider failure does not block newest listings', async () => {
  const db = await sandbox()
  let app
  try {
    for (const mutate of [
      (input) => {
        input.data.currency = 'EUR'
      },
      (input) => {
        delete input.data.rates.BTC
      },
      (input) => {
        input.data.rates.ETH = '0'
      },
      (input) => {
        input.data.rates.ETH = '-1'
      },
      (input) => {
        input.data.rates.ETH = 'NaN'
      },
      (input) => {
        input.data.rates.ETH = 1
      },
      (input) => {
        input.data.rates.USD = '2'
      }
    ]) {
      const input = rateData()
      mutate(input)
      await assert.rejects(
        new RatesService(db.client, async () => input).quote(),
        (error) => error.code === 'FX_UNAVAILABLE'
      )
      assert.equal(await db.client.rateSnapshot.count(), 0)
    }
    app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false, {
      loadRates: async () => {
        throw new Error('private-provider-failure')
      }
    })
    const response = await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: { sort: 'price_asc' } })
    assert.equal(response.statusCode, 503)
    assert.deepEqual(response.json(), { code: 'FX_UNAVAILABLE', retryable: true })
    assert.equal((await app.inject({ method: 'POST', url: '/api/listings/search', headers: { origin, 'content-type': 'application/json' }, payload: {} })).statusCode, 200)
  } finally {
    await app?.close()
    await db.close()
  }
})
