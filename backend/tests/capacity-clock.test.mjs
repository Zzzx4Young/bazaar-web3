import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityClock } from '../scripts/capacity-clock.mjs'

test('capacity clock compares wall time with monotonic elapsed time', () => {
  let wall = 100000, monotonic = 0
  const clock = capacityClock({ wallNow: () => wall, monotonicNow: () => monotonic })
  monotonic += 10000
  wall += 10000
  clock.sample()
  const evidence = clock.report()
  assert.equal(evidence.valid, true)
  assert.equal(evidence.maxAbsoluteDriftMs, 0)
  assert.equal(evidence.elapsedMs, 10000)
})

test('forward and backward clock jumps invalidate a load run even if throughput gates pass', () => {
  for (const jump of [20 * 60 * 60 * 1000, -2000]) {
    let wall = 100000, monotonic = 0
    const clock = capacityClock({ wallNow: () => wall, monotonicNow: () => monotonic })
    wall += 10000 + jump
    monotonic += 10000
    clock.sample()
    wall -= jump
    clock.sample()
    const evidence = clock.report()
    assert.equal(evidence.valid, false)
    assert.equal(evidence.maxAbsoluteDriftMs, Math.abs(jump))
    assert.equal(evidence.firstInvalidSample.driftMs, jump)
  }
})
