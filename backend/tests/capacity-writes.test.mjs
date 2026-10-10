import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityWrites } from '../scripts/capacity-writes.mjs'

test('write workload replays the original create and cancel keys and rejects a changed result', async () => {
  const calls = []
  const post = async (...args) => { calls.push(args); return { status: 200, value: { orderId: 'order-1' } } }
  const workload = capacityWrites(post, [{ id: 'physical-1' }])
  const user = { id: 'buyer-1' }
  await workload.send(0, user, 0)
  await workload.send(1, user, 0)
  await workload.send(2, user, 0)
  await workload.send(3, user, 0)
  assert.equal(calls[0][0], '/api/orders')
  assert.equal(calls[1][3], calls[0][3])
  assert.deepEqual(calls[1][1], calls[0][1])
  assert.equal(calls[2][0], '/api/orders/order-1/actions/cancel')
  assert.equal(calls[3][3], calls[2][3])
  assert.notEqual(calls[2][3], calls[0][3])
  assert.deepEqual(workload.stats, { created: 1, createReplays: 1, cancelled: 1, cancelReplays: 1 })
  let sequence = 0
  const broken = capacityWrites(async () => ({ status: 200, value: { orderId: `order-${++sequence}` } }), [{ id: 'physical-1' }])
  await broken.send(0, user, 0)
  await assert.rejects(broken.send(1, user, 0), { name: 'AssertionError' })
})

test('a delayed write cannot silently start the next phase for the same buyer', async () => {
  let finish
  const workload = capacityWrites(() => new Promise(resolve => { finish = resolve }), [{ id: 'physical-1' }])
  const user = { id: 'buyer-1' }
  const pending = workload.send(0, user, 0)
  await assert.rejects(workload.send(1, user, 0), { message: 'Write phase still in flight' })
  finish({ status: 200, value: { orderId: 'order-1' } })
  await pending
})

test('persistence audit rejects extra orders even when HTTP requests succeeded', async () => {
  const workload = capacityWrites(async () => ({ status: 200, value: { orderId: 'order-1' } }), [{ id: 'physical-1' }])
  await workload.send(0, { id: 'buyer-1' }, 0)
  await assert.rejects(workload.audit({ order: { findMany: async () => [{ id: 'order-1' }, { id: 'unexpected-order' }] } }),
    /Unexpected or missing persisted orders/)
})

test('ambiguous write failures recover with the same body and key and record failed attempts', async () => {
  const calls = []
  const workload = capacityWrites(async (...args) => {
    calls.push(args)
    return calls.length === 1 ? { status: 502, value: {} } : { status: 200, value: { orderId: 'order-1' } }
  }, [{ id: 'physical-1' }])
  await workload.send(0, { id: 'buyer-1' }, 0)
  assert.deepEqual(calls[1], calls[0])
  assert.equal(workload.stats.created, 1)
  assert.deepEqual(workload.recovery, { retryAttempts: 1, recoveredRequests: 1, failedRequests: 0,
    transientFailures: { HTTP_502: 1 } })
})

test('client recovery is bounded and does not retry a domain conflict', async () => {
  let calls = 0
  const unavailable = capacityWrites(async () => { calls++; return { status: 503, value: {} } }, [{ id: 'physical-1' }])
  await assert.rejects(unavailable.send(0, { id: 'buyer-1' }, 0), { code: 'HTTP_503' })
  assert.equal(calls, 3)
  assert.equal(unavailable.recovery.failedRequests, 1)
  calls = 0
  const conflict = capacityWrites(async () => { calls++; return { status: 409, value: { code: 'UNAVAILABLE' } } }, [{ id: 'physical-1' }])
  await assert.rejects(conflict.send(0, { id: 'buyer-1' }, 0), { code: 'HTTP_409' })
  assert.equal(calls, 1)
  assert.equal(conflict.recovery.retryAttempts, 0)
})
