import assert from 'node:assert/strict'
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
})
