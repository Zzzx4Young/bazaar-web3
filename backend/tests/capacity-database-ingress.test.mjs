import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityDatabaseUrls } from '../scripts/capacity-database-ingress.mjs'

const original = new URL('postgresql://runtime:fixture@127.0.0.1:41001/bazaar_test?schema=isolated')
test('dual ingress gives each API its own fixed endpoint without changing credentials or schema', () => {
  const [first, second] = capacityDatabaseUrls(original, '127.0.0.1:41002')
  assert.equal(first.toString(), original.toString())
  assert.equal(second.host, '127.0.0.1:41002')
  assert.equal(second.username, first.username)
  assert.equal(second.password, first.password)
  assert.equal(second.pathname, first.pathname)
  assert.equal(second.search, first.search)
  assert.notEqual(first, original)
  assert.equal(original.host, '127.0.0.1:41001')
})
test('legacy single-database test profile remains explicitly shared', () => {
  const [first, second] = capacityDatabaseUrls(original)
  assert.equal(first.toString(), second.toString())
  assert.notEqual(first, second)
})
test('second ingress cannot silently share the first gateway or redirect to an external database', () => {
  for (const endpoint of ['127.0.0.1:41001', '127.0.0.1:0', '127.0.0.1:65536',
    'remote.example:5432', 'postgresql://127.0.0.1:5432/other', '127.0.0.1:5432/other', ''])
    assert.throws(() => capacityDatabaseUrls(original, endpoint))
})
