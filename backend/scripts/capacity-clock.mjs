import { performance } from 'node:perf_hooks'

// Large wall-clock steps invalidate expiry and wall-clock fault timing evidence.
export const capacityClockToleranceMs = 1000

export function capacityClock({ wallNow = Date.now, monotonicNow = () => performance.now() } = {}) {
  const startedWallMs = wallNow(), startedMonotonicMs = monotonicNow()
  if (!Number.isFinite(startedWallMs) || !Number.isFinite(startedMonotonicMs))
    throw new Error('Invalid capacity clock observation')
  let maxAbsoluteDriftMs = 0, sampleCount = 0, firstInvalidSample
  let last
  function sample() {
    const wallMs = wallNow(), elapsedMs = monotonicNow() - startedMonotonicMs
    const driftMs = wallMs - startedWallMs - elapsedMs
    if (!Number.isFinite(wallMs) || !Number.isFinite(elapsedMs) || elapsedMs < 0 || (last && elapsedMs < last.elapsedMs))
      throw new Error('Invalid capacity clock observation')
    maxAbsoluteDriftMs = Math.max(maxAbsoluteDriftMs, Math.abs(driftMs))
    last = { wallMs, elapsedMs, driftMs }
    sampleCount++
    if (!firstInvalidSample && Math.abs(driftMs) > capacityClockToleranceMs)
      firstInvalidSample = last
    return last
  }
  return {
    sample,
    report() {
      sample()
      return {
        startedWallMs,
        finishedWallMs: last.wallMs,
        elapsedMs: last.elapsedMs,
        toleranceMs: capacityClockToleranceMs,
        maxAbsoluteDriftMs,
        sampleCount,
        firstInvalidSample,
        valid: maxAbsoluteDriftMs <= capacityClockToleranceMs
      }
    }
  }
}
