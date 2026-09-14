import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readConfig } from '../dist/config.js'

const DATABASE_URL = 'postgresql://test:secret@127.0.0.1:55432/bazaar_test'

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
