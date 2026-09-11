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
        const response = await app.inject({ method: 'GET', url: `/api/health/${path}` })
        assert.equal(response.statusCode, 200)
        assert.deepEqual(response.json(), { status: 'ok' })
      }
      assert.equal((await app.inject({ method: 'GET', url: '/api/unknown' })).statusCode, 404)
      const ping = database.ping
      database.ping = async () => {
        throw new Error('private connection details')
      }
      const failed = await app.inject({ method: 'GET', url: '/api/health/ready' })
      assert.equal(failed.statusCode, 503)
      assert.equal(failed.body.includes('private'), false)
      assert.equal((await app.inject({ method: 'GET', url: '/api/health/live' })).statusCode, 200)
      database.ping = ping
    } finally {
      await app.close()
    }
  }
})
