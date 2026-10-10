import assert from 'node:assert/strict'
import test from 'node:test'
import { DomainError, mapApplicationError } from '../dist/common/domain-error.js'
import { retryable } from '../dist/database/transaction.js'

const unavailable = { status: 503, code: 'DATABASE_UNAVAILABLE', retryable: true }
const internal = { status: 500, code: 'INTERNAL_ERROR', retryable: false }

test('database connection failures become a private 503 envelope without server transaction replay', () => {
  for (const error of [
    { code: 'P1001', message: 'private database address' },
    { code: 'P1017' },
    { code: 'P2024' },
    { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'DatabaseNotReachable' } } } },
    { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'ConnectionClosed' } } } },
    { cause: { kind: 'SocketTimeout' } },
    { meta: { code: '57P01' } },
    { meta: { driverAdapterError: { cause: { originalCode: '25006' } } } },
    { meta: { driverAdapterError: { cause: { originalCode: '08006' } } } },
    { code: 'ECONNRESET' },
    { code: 'ECONNREFUSED' },
    new Error('Connection terminated unexpectedly'),
    new Error('Connection terminated due to connection timeout'),
    new Error('timeout exceeded when trying to connect')
  ]) {
    assert.deepEqual(mapApplicationError(error), unavailable)
    assert.equal(
      retryable(error),
      false,
      'Unknown commit outcomes must not replay server transactions'
    )
  }
})

test('SQL defects, constraints, unknown errors and domain conflicts retain their existing semantics', () => {
  for (const error of [
    { code: 'P2010', meta: { code: '42P01' } },
    { meta: { driverAdapterError: { cause: { originalCode: '23514' } } } },
    { code: '57014' },
    { code: 'P2028' },
    new Error('private SQL and database credentials'),
    new Error('private SQL: Connection terminated unexpectedly'),
    { message: 'Connection terminated unexpectedly' },
    new DomainError('DATABASE_UNAVAILABLE'),
    new DomainError('ECONNRESET')
  ])
    assert.deepEqual(mapApplicationError(error), internal)
  assert.deepEqual(mapApplicationError(new DomainError('UNAVAILABLE')), {
    status: 409,
    code: 'UNAVAILABLE',
    retryable: false
  })
  const cycle = {}
  cycle.cause = cycle
  assert.deepEqual(mapApplicationError(cycle), internal)
})
