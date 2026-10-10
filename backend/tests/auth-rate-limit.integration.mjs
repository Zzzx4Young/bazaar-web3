import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { pruneExpiredAuthRateBuckets } from '../dist/auth/auth-rate-cleanup.js'
import { sandbox } from './helpers/database.mjs'

test('only trusted peers can supply client IPs and forwarding stops at the nearest untrusted hop', async () => {
  const db = await sandbox()
  const apps = []
  try {
    const direct = await createApp(readConfig({ DATABASE_URL: db.url.toString() }), false)
    const proxied = await createApp(readConfig({
      DATABASE_URL: db.url.toString(), TRUSTED_PROXY_CIDRS: '10.20.0.0/24'
    }), false)
    apps.push(direct, proxied)
    let attempt = 0
    const login = (app, remoteAddress, forwarded) => app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress,
      headers: { origin: 'http://localhost:3000', 'x-forwarded-for': forwarded },
      payload: { loginName: `missing-proxy-${attempt++}`, password: 'Virtual-invalid-password-123' }
    })
    for (let i = 0; i < 10; i++) {
      assert.equal((await login(direct, '192.0.2.10', `198.51.100.${i + 1}`)).statusCode, 401)
      assert.equal((await login(proxied, '192.0.2.20', `198.51.100.${i + 1}`)).statusCode, 401)
    }
    assert.equal((await login(direct, '192.0.2.10', '198.51.100.100')).statusCode, 429)
    assert.equal((await login(proxied, '192.0.2.20', '198.51.100.100')).statusCode, 429)

    for (let i = 0; i < 10; i++) {
      assert.equal((await login(proxied, '10.20.0.2', '198.51.100.10')).statusCode, 401)
    }
    assert.equal((await login(proxied, '10.20.0.2', '198.51.100.10')).statusCode, 429)
    assert.equal((await login(proxied, '10.20.0.2', '198.51.100.11')).statusCode, 401)
    for (let i = 0; i < 10; i++) {
      assert.equal((await login(proxied, '10.20.0.2', `203.0.113.${i + 1}, 198.51.100.20, 10.20.0.3`)).statusCode, 401)
    }
    assert.equal((await login(proxied, '10.20.0.2', '203.0.113.100, 198.51.100.20, 10.20.0.3')).statusCode, 429)
    for (const ip of ['192.0.2.10', '192.0.2.20', '198.51.100.10', '198.51.100.20']) {
      const key = createHash('sha256').update(`ip:${ip}`).digest('hex')
      assert.equal((await db.client.authRateBucket.findUniqueOrThrow({ where: { key } })).count, 10)
    }
  } finally {
    await Promise.all(apps.map((app) => app.close()))
    await db.close()
  }
})

test('login-name throttle is shared by independent API instances', async () => {
  const db = await sandbox()
  const apps = []
  try {
    const config = readConfig({ DATABASE_URL: db.url.toString() })
    apps.push(await createApp(config, false), await createApp(config, false))
    const login = (app, loginName = 'missing-account') => app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://localhost:3000' },
      payload: { loginName, password: 'Virtual-invalid-password-123' }
    })
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await login(apps[attempt % apps.length])
      assert.equal(response.statusCode, 401, response.body)
    }
    const limited = await login(apps[1])
    assert.equal(limited.statusCode, 429, limited.body)
    assert.equal(limited.headers['retry-after'], '60')

    await db.client.authRateBucket.deleteMany()
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      login(apps[index % apps.length], 'missing-concurrent')))
    assert.ok(responses.every((response) => [401, 429].includes(response.statusCode)))
    assert.ok(responses.filter((response) => response.statusCode === 401).length <= 5)
    const key = createHash('sha256').update('login:missing-concurrent').digest('hex')
    const bucket = await db.client.authRateBucket.findUniqueOrThrow({ where: { key } })
    assert.equal(bucket.count, 5)
    assert.deepEqual(
      (await db.client.authRateBucket.findMany()).map((row) => row.count).sort((a, b) => a - b),
      [5, 10]
    )
  } finally {
    await Promise.all(apps.map((app) => app.close()))
    await db.close()
  }
})

test('expired login buckets are pruned in bounded batches', async () => {
  const db = await sandbox()
  try {
    await db.client.authRateBucket.createMany({ data: [
      { key: 'a'.repeat(64), count: 1, windowEnd: new Date(Date.now() - 1000) },
      { key: 'b'.repeat(64), count: 1, windowEnd: new Date(Date.now() - 1000) },
      { key: 'c'.repeat(64), count: 1, windowEnd: new Date(Date.now() + 60000) }
    ] })
    assert.equal(await pruneExpiredAuthRateBuckets(db.client, 1), 1)
    assert.equal(await db.client.authRateBucket.count(), 2)
    assert.equal(await pruneExpiredAuthRateBuckets(db.client, 1), 1)
    assert.equal(await pruneExpiredAuthRateBuckets(db.client, 1), 0)
    assert.deepEqual((await db.client.authRateBucket.findMany()).map(({ key }) => key), ['c'.repeat(64)])
  } finally {
    await db.close()
  }
})
