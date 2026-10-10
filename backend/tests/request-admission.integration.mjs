import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import http from 'node:http'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { sandbox, bounded } from './helpers/database.mjs'

test('saturated database requests reject excess HTTP work and preserve liveness and request IDs', async () => {
  const db = await sandbox()
  let app
  const pending = []
  try {
    const tag = randomUUID()
    const url = new URL(db.url)
    url.searchParams.set('application_name', tag)
    const logs = []
    app = await createApp(
      readConfig({
        DATABASE_URL: url.toString(),
        DB_POOL_MAX: '2',
        DB_STATEMENT_TIMEOUT_MS: '2000',
        API_MAX_IN_FLIGHT: '2'
      }),
      false,
      { logRequest: (entry) => logs.push(entry) }
    )
    const database = app.get(DatabaseService)
    for (let index = 0; index < 2; index++)
      pending.push(
        database.client.$queryRaw`SELECT pg_backend_pid() FROM pg_sleep(0.5)`.then((rows) => rows)
      )
    const until = async (predicate) =>
      bounded(
        (async () => {
          while (!(await predicate())) await new Promise((resolve) => setTimeout(resolve, 5))
        })(),
        'Actual requests did not enter the expected state'
      )
    await until(
      async () =>
        (
          await db.client.$queryRaw`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE application_name = ${tag} AND wait_event = 'PgSleep'`
        )[0].count === 2
    )
    let entered = 0
    const ping = database.ping.bind(database)
    database.ping = async () => {
      entered++
      return ping()
    }
    const post = (path, id) =>
      app
        .inject({
          method: 'POST',
          url: path,
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
            'x-request-id': id
          },
          payload: {}
        })
        .then((response) => response)
    const waiting = [post('/api/health/ready', 'waiting-1'), post('/api/health/ready', 'waiting-2')]
    pending.push(...waiting)
    await until(async () => entered === 2)
    const excess = await post('/api/listings/home', 'excess-request')
    assert.equal(excess.statusCode, 503)
    assert.deepEqual(excess.json(), {
      code: 'OVERLOADED',
      retryable: true,
      requestId: 'excess-request'
    })
    assert.equal(excess.headers['cache-control'], 'no-store')
    assert.equal(excess.headers['x-request-id'], 'excess-request')
    assert.equal((await post('/api/health/live', 'live')).statusCode, 200)
    assert.ok((await Promise.all(waiting)).every((response) => response.statusCode === 200))
    assert.equal((await post('/api/listings/home', 'recovered')).statusCode, 200)
    assert.ok(
      logs.some((entry) => entry.requestId === 'excess-request' && entry.errorCode === 'OVERLOADED')
    )
  } finally {
    await Promise.allSettled(pending)
    await app?.close()
    await db.close()
  }
})

test('a disconnected client retains admission until database work settles and then releases it', async () => {
  const db = await sandbox()
  let app
  let client
  const pending = []
  try {
    app = await createApp(
      readConfig({ DATABASE_URL: db.url.toString(), API_MAX_IN_FLIGHT: '1' }),
      false
    )
    const database = app.get(DatabaseService)
    const ping = database.ping.bind(database)
    let entered = false
    let settled = false
    database.ping = async () => {
      entered = true
      try {
        await database.client.$queryRaw`SELECT pg_backend_pid() FROM pg_sleep(0.5)`
        return await ping()
      } finally {
        settled = true
      }
    }
    await app.listen({ port: 0, host: '127.0.0.1' })
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`
    const until = async (predicate, label) =>
      bounded(
        (async () => {
          while (!(await predicate())) await new Promise((resolve) => setTimeout(resolve, 5))
        })(),
        label
      )
    pending.push(
      new Promise((resolve) => {
        client = http.request(`${base}/api/health/ready`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }
        })
        client.on('error', resolve)
        client.on('response', (response) => {
          response.resume()
          response.on('end', resolve)
        })
        client.end('{}')
      })
    )
    await until(() => entered, 'Request did not enter database ping')
    client.destroy()
    const post = async (path) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: '{}'
      })
      await response.text()
      return response
    }
    assert.equal((await post('/api/listings/home')).status, 503)
    assert.equal(settled, false)
    await until(() => settled, 'Database work did not settle')
    await until(
      async () => (await post('/api/listings/home')).status === 200,
      'Admission did not recover after disconnected work settled'
    )
  } finally {
    client?.destroy()
    app?.getHttpServer().closeAllConnections()
    await Promise.allSettled(pending)
    await app?.close()
    await db.close()
  }
})
