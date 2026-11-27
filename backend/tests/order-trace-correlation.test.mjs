import assert from 'node:assert/strict'
import test from 'node:test'
import { correlateOrderEvents } from '../scripts/order-trace-correlation.mjs'

const events = [{ operation: 'create', request_id: 'command-key' }]
const responses = [{ commandKey: 'command-key', applicationRequestId: 'server-id', status: 200 }]
const logs = [{ requestId: 'server-id', method: 'POST', status: 200, route: '/api/orders' }]

test('Alpha correlates command keys through real response IDs after proxy strips client IDs', () => {
  assert.deepEqual(correlateOrderEvents(events, responses, logs), [{
    operation: 'create', commandKey: 'command-key', applicationRequestId: 'server-id'
  }])
})
test('Alpha correlation rejects missing or mismatched application trace, failed responses and keys', () => {
  for (const input of [[], [{ ...logs[0], requestId: 'command-key' }],
    [{ ...logs[0], method: 'GET' }], [{ ...logs[0], status: 500 }]])
    assert.throws(() => correlateOrderEvents(events, responses, input), /No application HTTP trace/)
  for (const response of [{ ...responses[0], status: 500 },
    { ...responses[0], commandKey: 'other' }])
    assert.throws(() => correlateOrderEvents(events, [response], logs), /No application HTTP trace/)
})

test('V2 admin refund commands correlate with their actual application trace', () => {
  const adminLog = { ...logs[0], route: '/api/admin/disputes/:id/resolve' }
  assert.equal(correlateOrderEvents(events, responses, [adminLog])[0].applicationRequestId, 'server-id')
  for (const route of ['/api/listings', '/api/orders-unrelated', '/api/admin/disputes-unrelated'])
    assert.throws(() => correlateOrderEvents(events, responses, [{ ...logs[0], route }]), /No application HTTP trace/)
})
