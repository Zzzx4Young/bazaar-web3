import assert from 'node:assert/strict'
import { createConnection, createServer } from 'node:net'
import { once } from 'node:events'
import test from 'node:test'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { sandbox } from './helpers/database.mjs'

test('a pooled connection that becomes read-only returns 503 and recovers without restarting the API', async () => {
  const db = await sandbox()
  let app
  try {
    const loginName = 'readonly-probe',
      password = 'Isolated-readonly-test-password'
    await provisionAccounts(db.client, [{ loginName, password, displayName: 'Read-only fixture' }])
    const config = readConfig({ DATABASE_URL: db.url.toString(), DB_POOL_MAX: '1' })
    app = await createApp(config, false)
    const login = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: config.appOrigin, 'content-type': 'application/json' },
        payload: { loginName, password }
      })
    assert.equal((await login()).statusCode, 200)
    const client = app.get(DatabaseService).client
    await client.$executeRawUnsafe('SET default_transaction_read_only = on')
    const failed = await login()
    assert.equal(failed.statusCode, 503, failed.body)
    assert.deepEqual(failed.json(), {
      code: 'DATABASE_UNAVAILABLE',
      retryable: true,
      requestId: failed.headers['x-request-id']
    })
    await client.$executeRawUnsafe('SET default_transaction_read_only = off')
    assert.equal((await login()).statusCode, 200)
  } finally {
    await app?.close()
    await db.close()
  }
})

test('a real PostgreSQL connection outage returns private retryable 503 and recovers on the original API', async () => {
  const db = await sandbox()
  const sockets = new Set()
  let unavailable = false,
    app
  const proxy = createServer((incoming) => {
    if (unavailable) {
      incoming.destroy()
      return
    }
    const upstream = createConnection({ host: db.url.hostname, port: Number(db.url.port) })
    for (const socket of [incoming, upstream]) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    }
    incoming.on('error', () => upstream.destroy())
    upstream.on('error', () => incoming.destroy())
    incoming.on('close', () => upstream.destroy())
    upstream.on('close', () => incoming.destroy())
    incoming.pipe(upstream)
    upstream.pipe(incoming)
  })
  try {
    proxy.listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    const url = new URL(db.url)
    url.hostname = '127.0.0.1'
    url.port = String(proxy.address().port)
    const config = readConfig({ DATABASE_URL: url.toString() })
    app = await createApp(config, false)
    const search = () =>
      app.inject({
        method: 'POST',
        url: '/api/listings/search',
        headers: { origin: config.appOrigin, 'content-type': 'application/json' },
        payload: { limit: '10', page: '1' }
      })
    assert.equal((await search()).statusCode, 200)
    unavailable = true
    for (const socket of sockets) socket.destroy()
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await search()
      if (response.statusCode !== 503) {
        try {
          await app.get(DatabaseService).ping()
        } catch (error) {
          const messages = [
            'Connection terminated unexpectedly',
            'Connection terminated due to connection timeout',
            'timeout exceeded when trying to connect'
          ]
          console.log(
            JSON.stringify({
              driverName: error.name,
              driverCode: error.code,
              driverKind: error.meta?.driverAdapterError?.cause?.kind,
              pgMessageCategory: messages.includes(error.message) ? error.message : 'other'
            })
          )
        }
      }
      assert.equal(response.statusCode, 503, response.body)
      assert.deepEqual(response.json(), {
        code: 'DATABASE_UNAVAILABLE',
        retryable: true,
        requestId: response.headers['x-request-id']
      })
      assert.equal(response.headers['cache-control'], 'no-store')
      for (const privateValue of [db.url.password, db.schema, db.url.hostname]) {
        assert.ok(!response.body.includes(privateValue), 'Database details must remain private')
      }
    }
    unavailable = false
    assert.equal((await search()).statusCode, 200)
  } finally {
    await app?.close()
    for (const socket of sockets) socket.destroy()
    if (proxy.listening) await new Promise((resolve) => proxy.close(resolve))
    await db.close()
  }
})
