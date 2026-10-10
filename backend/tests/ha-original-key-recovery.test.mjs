import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { recoverOriginalKey } from '../scripts/ha-original-key-recovery.mjs'

const response = (status, id = 'known-order') => ({ status, value: { orderId: id } })
test('independent gateway replay recovers only the original order within the shared deadline', async () => {
  let calls = 0
  const result = await recoverOriginalKey({ request: async () => response(++calls === 1 ? 503 : 200),
    orderId: 'known-order', deadlineMs: performance.now() + 1000, pollMs: 0 })
  assert.equal(calls, 2)
  assert.equal(result.attempts, 2)
  assert.deepEqual(result.statuses, { 503: 1, 200: 1 })
})
test('a changed replay order or a business rejection cannot be hidden by recovery retries', async () => {
  for (const failure of [response(200, 'other-order'), response(403), response(500)]) {
    let calls = 0
    await assert.rejects(recoverOriginalKey({ request: async () => { calls++; return failure },
      orderId: 'known-order', deadlineMs: performance.now() + 1000, pollMs: 0 }))
    assert.equal(calls, 1)
  }
})
test('an expired original failover deadline cannot grant another 60-second recovery window', async () => {
  let calls = 0
  await assert.rejects(recoverOriginalKey({ request: async () => { calls++; return response(200) },
    orderId: 'known-order', deadlineMs: performance.now() - 1, pollMs: 0 }))
  assert.equal(calls, 0)
})

test('a successful late response cannot pass the original recovery deadline', async () => {
  await assert.rejects(recoverOriginalKey({ request: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return response(200)
  }, orderId: 'known-order', deadlineMs: performance.now() + 5, pollMs: 0 }))
})
