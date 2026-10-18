import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'
import { MediaService } from '../dist/media/media.service.js'
import { sandbox } from './helpers/database.mjs'

const origin = 'http://localhost:3000'
const password = 'Media-api-manual-password'
const secret = (name) => readFileSync(new URL(`../../infra/.secrets/garage-app/${name}`, import.meta.url), 'utf8').trim()
const credentials = (tier) => ({ accessKeyId: secret(`${tier}_access_key_id`), secretAccessKey: secret(`${tier}_secret_key`) })
const store = new GarageObjectStore({
  hotEndpoint: 'http://127.0.0.1:3900', hotPublicEndpoint: 'http://127.0.0.1:3900',
  coldEndpoint: 'http://127.0.0.1:3903', hotCredentials: credentials('hot'),
  coldCredentials: credentials('cold'), hotBucket: 'bazaar-hot', coldBucket: 'bazaar-cold'
})

test('seller can verify real uploaded bytes; a different account cannot complete them', async () => {
  const db = await sandbox()
  let app, unavailableApp
  try {
    const names = [
      `media_seller_${randomUUID()}`,
      `media_other_${randomUUID()}`,
      `media_outsider_${randomUUID()}`
    ]
    await provisionAccounts(db.client, names.map((loginName) => ({ loginName, displayName: loginName, password })))
    app = await createApp(readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin }), false, { mediaStore: store })
    const login = async (loginName) => {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { loginName, password } })
      assert.equal(response.statusCode, 200, response.body)
      return { origin, cookie: response.headers['set-cookie'].split(';')[0], 'x-csrf-token': response.json().csrfToken }
    }
    const seller = await login(names[0]), other = await login(names[1]), outsider = await login(names[2])
    const bytes = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex')
    unavailableApp = await createApp({
      ...readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin }),
      mediaStore: null
    }, false)
    const unavailableUpload = await unavailableApp.inject({
      method: 'POST', url: '/api/media/upload-intents', headers: seller,
      payload: { contentType: 'image/png', byteSize: bytes.length }
    })
    assert.equal(unavailableUpload.statusCode, 503, unavailableUpload.body)
    assert.equal(unavailableUpload.json().code, 'MEDIA_UNAVAILABLE')
    await unavailableApp.close()
    unavailableApp = undefined
    const uploadIntent = (contentType, byteSize) => app.inject({
      method: 'POST', url: '/api/media/upload-intents', headers: seller,
      payload: { contentType, byteSize }
    })
    assert.equal((await uploadIntent('text/html', bytes.length)).statusCode, 400)
    assert.equal((await uploadIntent('image/png', 5 * 1024 * 1024 + 1)).statusCode, 400)
    const incompleteIntent = await uploadIntent('image/png', bytes.length)
    assert.equal(incompleteIntent.statusCode, 201, incompleteIntent.body)
    assert.equal((await app.inject({ method: 'POST',
      url: `/api/media/${incompleteIntent.json().assetId}/complete`, headers: seller,
      payload: {} })).statusCode, 400)
    const forgedIntent = await uploadIntent('image/jpeg', bytes.length)
    assert.equal(forgedIntent.statusCode, 201, forgedIntent.body)
    assert.equal((await fetch(forgedIntent.json().uploadUrl, { method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' }, body: bytes })).status, 200)
    assert.equal((await app.inject({ method: 'POST',
      url: `/api/media/${forgedIntent.json().assetId}/complete`, headers: seller,
      payload: {} })).statusCode, 400)
    const intent = await app.inject({
      method: 'POST', url: '/api/media/upload-intents', headers: seller,
      payload: { contentType: 'image/png', byteSize: bytes.length }
    })
    assert.equal(intent.statusCode, 201, intent.body)
    assert.equal((await fetch(intent.json().uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes })).status, 200)
    const complete = (headers) => app.inject({ method: 'POST', url: `/api/media/${intent.json().assetId}/complete`, headers, payload: {} })
    assert.equal((await complete(other)).statusCode, 403)
    const done = await complete(seller)
    assert.equal(done.statusCode, 200, done.body)
    assert.equal(done.json().status, 'ready')
    assert.equal((await complete(seller)).json().sha256, done.json().sha256)
    const listing = {
      type: 'physical', saleMode: 'one_off', title: 'Photo listing',
      description: 'A listing with verified media', category: 'electronics',
      price: { amount: '9', currency: 'USD' }, mediaIds: [done.json().assetId]
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/listings', headers: seller,
      payload: { ...listing, mediaIds: [] } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/api/listings', headers: other,
      payload: listing })).statusCode, 403)
    const created = await app.inject({ method: 'POST', url: '/api/listings', headers: seller, payload: listing })
    assert.equal(created.statusCode, 201, created.body)
    assert.deepEqual(created.json().media.map((entry) => entry.id), [done.json().assetId])
    const photoUrl = created.json().media[0].url
    const publicPhoto = await app.inject({ method: 'GET', url: photoUrl })
    assert.equal(publicPhoto.statusCode, 200, publicPhoto.body)
    assert.deepEqual(publicPhoto.rawPayload, bytes)
    assert.equal(publicPhoto.headers['cache-control'], 'no-store')
    const bought = await app.inject({ method: 'POST', url: '/api/orders',
      headers: { ...other, 'idempotency-key': randomUUID() },
      payload: { listingId: created.json().id, version: 1,
        shipping: { recipient: 'Test buyer', contact: 'virtual', address: 'Virtual test address' } } })
    assert.equal(bought.statusCode, 200, bought.body)
    const orderId = bought.json().orderId
    const orderPhotoUrl = `/api/orders/${orderId}/media/${done.json().assetId}`
    const orderPhoto = await app.inject({ method: 'GET', url: orderPhotoUrl, headers: other })
    assert.equal(orderPhoto.statusCode, 200, orderPhoto.body)
    assert.deepEqual(orderPhoto.rawPayload, bytes)
    assert.equal((await app.inject({ method: 'GET', url: orderPhotoUrl, headers: outsider })).statusCode, 404)
    const detail = await app.inject({ method: 'POST', url: `/api/orders/${orderId}`, headers: other, payload: {} })
    assert.deepEqual(detail.json().snapshot.media.map((entry) => entry.id), [done.json().assetId])
    const down = await app.inject({ method: 'POST',
      url: `/api/listings/${created.json().id}/edit`, headers: seller,
      payload: { version: 1, publicationStatus: 'withdrawn' } })
    assert.equal(down.statusCode, 200, down.body)
    assert.equal((await app.inject({ method: 'GET', url: photoUrl })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: orderPhotoUrl, headers: other })).statusCode, 200)
    await assert.rejects(
      new MediaService(db.client, { readHot: async () => { throw new Error('Garage unavailable') } })
        .readOrder(orderId, done.json().assetId, (await db.client.account.findUniqueOrThrow({
          where: { loginName: names[1] }
        })).id),
      (error) => error.code === 'MEDIA_UNAVAILABLE'
    )
    assert.equal((await app.inject({ method: 'POST',
      url: `/api/listings/${created.json().id}/edit`, headers: seller,
      payload: { version: 2, description: 'Changed after first order' } })).statusCode, 409)

    const uploadMore = async () => {
      const next = await app.inject({ method: 'POST', url: '/api/media/upload-intents',
        headers: seller, payload: { contentType: 'image/png', byteSize: bytes.length } })
      assert.equal(next.statusCode, 201, next.body)
      assert.equal((await fetch(next.json().uploadUrl, { method: 'PUT',
        headers: { 'Content-Type': 'image/png' }, body: bytes })).status, 200)
      const ready = await completeAsset(next.json().assetId)
      return ready.assetId
    }
    const completeAsset = async (assetId) => {
      const response = await app.inject({ method: 'POST',
        url: `/api/media/${assetId}/complete`, headers: seller, payload: {} })
      assert.equal(response.statusCode, 200, response.body)
      return response.json()
    }
    const oldAssetId = await uploadMore(), newAssetId = await uploadMore()
    const recurring = await app.inject({ method: 'POST', url: '/api/listings', headers: seller,
      payload: { type: 'digital', saleMode: 'repeatable', supplyMode: 'unlimited',
        title: 'Repeatable service', description: 'Original repeatable description',
        category: 'digital_assets', price: { amount: '5', currency: 'USD' },
        licenseDescription: 'Service access', contentVersion: 'v1', mediaIds: [oldAssetId] } })
    assert.equal(recurring.statusCode, 201, recurring.body)
    const buyRecurring = async (headers, version) => {
      const response = await app.inject({ method: 'POST', url: '/api/orders',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: { listingId: recurring.json().id, version } })
      assert.equal(response.statusCode, 200, response.body)
      return response.json().orderId
    }
    const oldOrder = await buyRecurring(other, 1)
    const edited = await app.inject({ method: 'POST',
      url: `/api/listings/${recurring.json().id}/edit`, headers: seller,
      payload: { version: 1, description: 'Updated repeatable description', mediaIds: [newAssetId] } })
    assert.equal(edited.statusCode, 200, edited.body)
    const newOrder = await buyRecurring(outsider, 2)
    const orderDetail = async (orderId, headers) => (await app.inject({ method: 'POST',
      url: `/api/orders/${orderId}`, headers, payload: {} })).json()
    assert.deepEqual((await orderDetail(oldOrder, other)).snapshot.media.map((m) => m.id), [oldAssetId])
    assert.deepEqual((await orderDetail(newOrder, outsider)).snapshot.media.map((m) => m.id), [newAssetId])
    assert.equal((await orderDetail(oldOrder, other)).snapshot.description, 'Original repeatable description')
    assert.equal((await orderDetail(newOrder, outsider)).snapshot.description, 'Updated repeatable description')
    assert.equal((await app.inject({ method: 'POST', url: '/api/listings', headers: seller,
      payload: listing })).statusCode, 409)
  } finally {
    await unavailableApp?.close()
    await app?.close()
    try {
      const assets = await db.client.mediaAsset.findMany({
        select: { uploadKey: true, hotKey: true }
      })
      for (const key of new Set(assets.flatMap((asset) =>
        [asset.uploadKey, asset.hotKey].filter(Boolean))))
        await store.deleteHot(key)
    } finally {
      await db.close()
    }
  }
})
