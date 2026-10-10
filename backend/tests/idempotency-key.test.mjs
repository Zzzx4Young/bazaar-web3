import assert from 'node:assert/strict'
import test from 'node:test'
import { idempotencyKey } from '../dist/orders/idempotency-key.js'

test('idempotency keys retain ASCII boundaries and reject invalid complete inputs', () => {
  for (const key of ['a', 'a'.repeat(100), 'ABC_123-xyz'])
    assert.equal(idempotencyKey(key), key)
  for (const key of [undefined, ['a'], '', 'a'.repeat(101), 'a b', 'a\n', '😀', 'a/b'])
    assert.throws(() => idempotencyKey(key), error => error.code === 'INVALID_INPUT')
})
