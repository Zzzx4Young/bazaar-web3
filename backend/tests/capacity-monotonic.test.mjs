import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { monotonicNow, monotonicElapsedMs, monotonicNs } from '../scripts/capacity-monotonic.mjs'

test('local parent and child fault timestamps share a monotonic clock independently of epoch time', () => {
  const before = monotonicNow()
  const child = execFileSync(process.execPath,
    ['-e', 'process.stdout.write(process.hrtime.bigint().toString())'], { encoding: 'utf8' })
  const after = monotonicNow()
  assert.ok(monotonicElapsedMs(before, child) >= 0)
  assert.ok(monotonicElapsedMs(child, after) >= 0)
})
test('monotonic fault duration retains sub-millisecond precision and rejects malformed or reversed records', () => {
  assert.equal(monotonicElapsedMs('1000000000', '1001500000'), 1.5)
  for (const value of [undefined, 1000, '-1', 'NaN', '1.5', ''])
    assert.throws(() => monotonicNs(value))
  assert.throws(() => monotonicElapsedMs('2000', '1000'))
})
