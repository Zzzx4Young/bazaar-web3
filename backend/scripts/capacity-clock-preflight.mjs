import assert from 'node:assert/strict'
import { capacityClock, capacityClockToleranceMs } from './capacity-clock.mjs'

export const capacityClockPreflightPolicy = Object.freeze({
  durationMs: 60_000,
  sampleIntervalMs: 250
})

export async function capacityClockPreflight({
  wallNow,
  monotonicNow,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  durationMs = capacityClockPreflightPolicy.durationMs,
  sampleIntervalMs = capacityClockPreflightPolicy.sampleIntervalMs
} = {}) {
  assert.ok(Number.isFinite(durationMs) && durationMs > 0)
  assert.ok(Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0)
  const evidence = {
    timestamp: new Date().toISOString(),
    scope: 'environment clock only; no database or capacity acceptance',
    policy: { durationMs, sampleIntervalMs, toleranceMs: capacityClockToleranceMs },
    samples: []
  }
  try {
    const clock = capacityClock({ wallNow, monotonicNow })
    while (true) {
      const observation = clock.sample()
      evidence.samples.push(observation)
      if (Math.abs(observation.driftMs) > capacityClockToleranceMs || observation.elapsedMs >= durationMs) {
        const report = clock.report()
        return { ...evidence, clock: report, valid: report.valid }
      }
      await wait(Math.min(sampleIntervalMs, durationMs - observation.elapsedMs))
    }
  } catch {
    return { ...evidence, valid: false, failure: 'invalid-clock-observation' }
  }
}

export async function capacitySetupAfterClockPreflight({
  observe = capacityClockPreflight,
  persistReport,
  setup
}) {
  const report = await observe()
  await persistReport(report)
  assert.equal(report.valid, true, 'Environment clock preflight failed; resource setup was not started')
  return setup()
}
