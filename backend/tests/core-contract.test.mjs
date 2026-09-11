import assert from 'node:assert/strict'
import test from 'node:test'
import { DomainError, mapApplicationError } from '../dist/common/domain-error.js'
import { parseStoredAmount } from '../dist/common/money.js'
import { retryable } from '../dist/database/transaction.js'

test('C1 money input rejects rounding, special values and floating-point numbers', () => {
  const exact = '12345678901234567890.123456789012345678'
  assert.equal(parseStoredAmount(exact).toFixed(18), exact)
  assert.equal(parseStoredAmount('0.000000000000000001').toFixed(18), '0.000000000000000001')
  for (const input of [
    'NaN',
    'Infinity',
    '-1',
    '0',
    '0.000',
    '1e3',
    '1.1234567890123456789',
    '123456789012345678901',
    0.1,
    ' 1',
    '01'
  ]) {
    assert.throws(
      () => parseStoredAmount(input),
      (e) => e.code === 'INVALID_AMOUNT'
    )
  }
})

test('C1 maps only known errors and does not expose database messages', () => {
  for (const [code, status] of [
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['INVALID_AMOUNT', 400],
    ['STATE_CONFLICT', 409],
    ['RETRY_EXHAUSTED', 503]
  ]) {
    assert.deepEqual(mapApplicationError(new DomainError(code)), {
      status,
      code,
      retryable: status === 503
    })
  }
  assert.deepEqual(mapApplicationError({ code: 'P2002', message: 'private SQL' }), {
    status: 409,
    code: 'CONFLICT',
    retryable: false
  })
  assert.deepEqual(mapApplicationError(new DomainError('private injected data')), {
    status: 500,
    code: 'INTERNAL_ERROR',
    retryable: false
  })
  assert.equal(
    JSON.stringify(mapApplicationError(new Error('private password'))).includes('private'),
    false
  )
})

test('C1 retries only recognized transient transaction failures, not unknown commit outcomes', () => {
  assert.equal(
    retryable({ meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } }),
    true
  )
  for (const code of ['P2002', '23514', 'P1001', 'ECONNRESET', '57014'])
    assert.equal(retryable({ code }), false)
  assert.equal(retryable(new DomainError('STATE_CONFLICT')), false)
})
