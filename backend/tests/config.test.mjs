import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readConfig } from '../dist/config.js'

const DATABASE_URL = 'postgresql://test:secret@127.0.0.1:55432/bazaar_test'

test('request admission has a bounded deployment limit', () => {
  assert.equal(readConfig({ DATABASE_URL }).maxInFlightRequests, 200)
  assert.equal(readConfig({ DATABASE_URL, API_MAX_IN_FLIGHT: '2' }).maxInFlightRequests, 2)
  for (const value of ['0', '-1', '1.5', '10001', '', 'x'])
    assert.throws(() => readConfig({ DATABASE_URL, API_MAX_IN_FLIGHT: value }), /API_MAX_IN_FLIGHT/)
})

test('database pool limits have bounded deployment overrides', () => {
  assert.deepEqual(readConfig({ DATABASE_URL }).databasePool, {
    max: 5,
    connectionTimeoutMs: 3000,
    idleTimeoutMs: 10000,
    statementTimeoutMs: 3000
  })
  assert.deepEqual(
    readConfig({
      DATABASE_URL,
      DB_POOL_MAX: '2',
      DB_CONNECT_TIMEOUT_MS: '2000',
      DB_IDLE_TIMEOUT_MS: '5000',
      DB_STATEMENT_TIMEOUT_MS: '250'
    }).databasePool,
    {
      max: 2,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 5000,
      statementTimeoutMs: 250
    }
  )
  for (const name of [
    'DB_POOL_MAX',
    'DB_CONNECT_TIMEOUT_MS',
    'DB_IDLE_TIMEOUT_MS',
    'DB_STATEMENT_TIMEOUT_MS'
  ]) {
    for (const value of ['0', '-1', '', '1.5', '1e3', 'abc', '1000000']) {
      assert.throws(() => readConfig({ DATABASE_URL, [name]: value }), new RegExp(name))
    }
  }
  for (const name of ['statement_timeout', 'options', 'connectionTimeoutMillis', 'query_timeout']) {
    assert.throws(() => readConfig({ DATABASE_URL: `${DATABASE_URL}?${name}=0` }), /connection URL/)
  }
})

test('proxy trust defaults off and accepts only explicit IP addresses and CIDRs', () => {
  assert.equal(readConfig({ DATABASE_URL }).trustedProxyCidrs, false)
  assert.deepEqual(
    readConfig({ DATABASE_URL, TRUSTED_PROXY_CIDRS: '127.0.0.1, ::1/128,10.20.0.0/24' })
      .trustedProxyCidrs,
    ['127.0.0.1', '::1/128', '10.20.0.0/24']
  )
  for (const TRUSTED_PROXY_CIDRS of [
    'true',
    '1',
    '*',
    'loopback',
    'localhost',
    '127.0.0.1,',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/33',
    '::1/129',
    '127.0.0.1/-1',
    '127.0.0.1/1.5'
  ]) {
    assert.throws(() => readConfig({ DATABASE_URL, TRUSTED_PROXY_CIDRS }), /TRUSTED_PROXY_CIDRS/)
  }
})

test('validates configuration and defaults to loopback', () => {
  assert.equal(readConfig({ DATABASE_URL }).host, '127.0.0.1')
  assert.equal(readConfig({ DATABASE_URL }).port, 3001)
  for (const value of [undefined, '', 'https://example.com', 'postgresql://']) {
    assert.throws(() => readConfig({ DATABASE_URL: value }), /PostgreSQL connection URL/)
  }
  for (const PORT of ['0', '-1', '65536', 'abc', '1.5']) {
    assert.throws(() => readConfig({ DATABASE_URL, PORT }), /PORT/)
  }
  for (const APP_ORIGIN of [
    'null',
    'http://remote.example',
    'https://safe.example/path',
    'https://user:pass@safe.example',
    'https://safe.example/'
  ])
    assert.throws(() => readConfig({ DATABASE_URL, APP_ORIGIN }), /APP_ORIGIN/)
  assert.equal(readConfig({ DATABASE_URL, APP_ORIGIN: 'https://safe.example' }).secureCookie, true)
  assert.equal(readConfig({ DATABASE_URL }).secureCookie, false)
})

test('reads a database URL from a secret file without allowing ambiguous input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bazaar-config-'))
  const file = join(directory, 'database-url')
  try {
    writeFileSync(file, `${DATABASE_URL}\n`, { mode: 0o600 })
    assert.equal(readConfig({ DATABASE_URL_FILE: file }).databaseUrl, DATABASE_URL)
    assert.throws(
      () => readConfig({ DATABASE_URL, DATABASE_URL_FILE: file }),
      /PostgreSQL connection URL/
    )
    writeFileSync(file, `${DATABASE_URL}\nsecond-line`, { mode: 0o600 })
    assert.throws(() => readConfig({ DATABASE_URL_FILE: file }), /PostgreSQL connection URL/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
