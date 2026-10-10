import assert from 'node:assert/strict'

const nanosecondsPerMillisecond = 1_000_000n
export const monotonicNow = () => process.hrtime.bigint().toString()
export function monotonicNs(value) {
  assert.ok(typeof value === 'string' && /^\d+$/.test(value), 'Missing monotonic fault timestamp')
  return BigInt(value)
}
export function monotonicElapsedMs(start, end) {
  const elapsed = monotonicNs(end) - monotonicNs(start)
  assert.ok(elapsed >= 0n, 'Monotonic fault journal moved backwards')
  return Number(elapsed) / Number(nanosecondsPerMillisecond)
}
