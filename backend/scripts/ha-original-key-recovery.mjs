import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

// The caller retains the original payload/key and the deadline of the original fault.
export async function recoverOriginalKey({ request, orderId, deadlineMs, pollMs }) {
  assert.ok(Number.isFinite(deadlineMs) && Number.isFinite(pollMs) && pollMs >= 0)
  let attempts = 0
  const statuses = {}
  while (performance.now() < deadlineMs) {
    const response = await request()
    attempts++
    statuses[response.status] = (statuses[response.status] ?? 0) + 1
    assert.ok(performance.now() <= deadlineMs, 'Original failover deadline exceeded')
    if (response.status === 200) {
      assert.equal(response.value.orderId, orderId, 'Original replay changed the order identity')
      return { attempts, statuses }
    }
    assert.equal(response.status, 503, 'Unexpected original-key recovery response')
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, deadlineMs - performance.now())))
  }
  throw new Error('Original failover deadline exceeded')
}
