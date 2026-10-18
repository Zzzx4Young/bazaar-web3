import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'

const secret = (name) => readFileSync(new URL(`../../infra/.secrets/garage-app/${name}`, import.meta.url), 'utf8').trim()
const credentials = (tier) => ({
  accessKeyId: secret(`${tier}_access_key_id`),
  secretAccessKey: secret(`${tier}_secret_key`)
})

test('Garage presigned PUT, verified hot read and distinct cold copy survive round-trip', async () => {
  const store = new GarageObjectStore({
    hotEndpoint: 'http://127.0.0.1:3900',
    hotPublicEndpoint: 'http://127.0.0.1:3900',
    coldEndpoint: 'http://127.0.0.1:3903',
    hotCredentials: credentials('hot'),
    coldCredentials: credentials('cold'),
    hotBucket: 'bazaar-hot',
    coldBucket: 'bazaar-cold'
  })
  const key = `manual/${randomUUID()}.png`
  const bytes = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex')
  try {
    const url = await store.createUploadUrl(key, 'image/png', 300)
    const uploaded = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: bytes
    })
    assert.equal(uploaded.status, 200, (await uploaded.text()).match(/<Code>([^<]*)<\/Code>/)?.[1])
    const head = await store.headHot(key)
    assert.equal(head.contentLength, bytes.length)
    assert.deepEqual((await store.readHot(key)).bytes, bytes)
    await store.putCold(key, bytes, 'image/png')
    assert.deepEqual((await store.readCold(key)).bytes, bytes)
  } finally {
    await store.deleteHot(key)
    await store.deleteCold(key)
  }
})
