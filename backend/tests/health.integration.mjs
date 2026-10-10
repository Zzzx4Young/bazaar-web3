import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'

// Explicit test connection only; never fall back to the application's DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/bazaar_test') {
  throw new Error('TEST_DATABASE_URL must explicitly target bazaar_test')
}

test('configured pool bounds concurrent connections and enforces SQL timeout with recovery', async () => {
  const app = await createApp(readConfig({ DATABASE_URL: url, DB_POOL_MAX: '2',
    DB_STATEMENT_TIMEOUT_MS: '250' }), false)
  try {
    const client = app.get(DatabaseService).client
    const settings = await client.$queryRaw`SELECT current_setting('statement_timeout') AS timeout`
    assert.equal(settings[0].timeout, '250ms')
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      client.$queryRaw`SELECT pg_backend_pid() AS pid FROM pg_sleep(0.05)`))
    assert.equal(new Set(results.map((rows) => rows[0].pid)).size, 2)
    await assert.rejects(client.$queryRaw`SELECT 1 AS value FROM pg_sleep(1)`, (error) =>
      error.meta?.code === '57014' ||
      error.meta?.driverAdapterError?.cause?.originalCode === '57014')
    assert.equal((await client.$queryRaw`SELECT 1 AS value`)[0].value, 1)
  } finally {
    await app.close()
  }
})

test('real PostgreSQL readiness, failure mapping, and reconnection', async (context) => {
  const config = readConfig({ DATABASE_URL: url })
  for (let run = 0; run < 2; run++) {
    const app = await createApp(config, false)
    try {
      const database = app.get(DatabaseService)
      const version = await database.client
        .$queryRaw`SELECT current_setting('server_version') AS version`
      assert.match(version[0].version, /^17\./)
      if (run === 0) context.diagnostic(`PostgreSQL server_version: ${version[0].version}`)
      for (const path of ['live', 'ready']) {
        const requestId = `health-${run}-${path}`
        const response = await app.inject({ method: 'POST', url: `/api/health/${path}`, headers: { origin: config.appOrigin, 'content-type': 'application/json', 'x-request-id': requestId }, payload: {} })
        assert.equal(response.statusCode, 200)
        assert.equal(response.headers['x-request-id'], requestId)
        if (path === 'live') assert.deepEqual(response.json(), { status: 'ok' })
        else {
          assert.equal(response.json().status, 'ok')
          assert.deepEqual(response.json().database.status, 'ok')
          assert.equal(typeof response.json().database.latencyMs, 'number')
          assert.ok(response.json().database.latencyMs >= 0)
        }
      }
      const unknown = await app.inject({ method: 'POST', url: '/api/unknown', headers: { origin: config.appOrigin, 'content-type': 'application/json', 'x-request-id': 'invalid request id' }, payload: {} })
      assert.equal(unknown.statusCode, 404)
      assert.equal(unknown.json().requestId, unknown.headers['x-request-id'])
      assert.match(unknown.json().requestId, /^[0-9a-f-]{36}$/)
      const ping = database.ping
      database.ping = async () => {
        throw new Error('private connection details')
      }
      const failed = await app.inject({ method: 'POST', url: '/api/health/ready', headers: { origin: config.appOrigin, 'content-type': 'application/json' }, payload: {} })
      assert.equal(failed.statusCode, 503)
      assert.equal(failed.body.includes('private'), false)
      assert.equal((await app.inject({ method: 'POST', url: '/api/health/live', headers: { origin: config.appOrigin, 'content-type': 'application/json' }, payload: {} })).statusCode, 200)
      database.ping = ping
    } finally {
      await app.close()
    }
  }
})

// Session setting only, on this application's single connection; no cluster-wide changes.
test('readiness rejects a readable but read-only PostgreSQL session and recovers', async () => {
  const config = readConfig({ DATABASE_URL: url, DB_POOL_MAX: '1' })
  const app = await createApp(config, false)
  const database = app.get(DatabaseService)
  const probe = (path) => app.inject({ method: 'POST', url: `/api/health/${path}`,
    headers: { origin: config.appOrigin, 'content-type': 'application/json' }, payload: {} })
  try {
    assert.equal((await probe('ready')).statusCode, 200)
    await database.client.$executeRaw`SET default_transaction_read_only = on`
    assert.equal((await database.client.$queryRaw`SELECT 1 AS value`)[0].value, 1)
    assert.equal((await probe('live')).statusCode, 200)
    const blocked = await probe('ready')
    assert.equal(blocked.statusCode, 503)
    assert.equal(blocked.body.includes('postgresql://'), false)
    await database.client.$executeRaw`SET default_transaction_read_only = off`
    assert.equal((await probe('ready')).statusCode, 200)
  } finally {
    await database.client.$executeRaw`SET default_transaction_read_only = off`
    await app.close()
  }
})
