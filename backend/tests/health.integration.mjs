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
        assert.deepEqual(response.json(), { status: 'ok' })
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
