import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { sandbox } from './helpers/database.mjs'

test('unexpected Prisma failure returns only the public error envelope', async () => {
  const db = await sandbox()
  let app
  try {
    app = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false)
    // The disposable schema deliberately loses a table after startup, causing a real
    // database driver failure without relying on a mocked exception.
    await db.client.$executeRaw`DROP TABLE "Listing" CASCADE`
    const response = await app.inject({
      method: 'POST', url: '/api/listings/search',
      headers: { origin: 'http://localhost:3000' }, payload: {}
    })
    assert.equal(response.statusCode, 500, response.body)
    assert.deepEqual(Object.keys(response.json()).sort(), ['code', 'requestId', 'retryable'])
    assert.equal(response.json().code, 'INTERNAL_ERROR')
    assert.equal(response.json().retryable, false)
    assert.equal(response.body.includes('Listing'), false)
    assert.equal(response.body.includes('SELECT'), false)
    assert.equal(response.body.includes('prisma'), false)
  } finally {
    await app?.close()
    await db.close()
  }
})
