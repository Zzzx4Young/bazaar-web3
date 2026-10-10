import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityClockPreflight, capacitySetupAfterClockPreflight } from '../scripts/capacity-clock-preflight.mjs'

function fixture(jump = 0) {
  let wall = 100000, mono = 0, waits = 0
  return {
    options: {
      durationMs: 1000, sampleIntervalMs: 250,
      wallNow: () => wall, monotonicNow: () => mono,
      wait: async (ms) => { wall += ms; mono += ms; if (++waits === 2) wall += jump }
    },
    waits: () => waits
  }
}

test('preflight observes a full monotonic window before allowing setup and persists evidence first', async () => {
  const f = fixture()
  const events = []
  const result = await capacitySetupAfterClockPreflight({
    observe: () => capacityClockPreflight(f.options),
    persistReport: async (report) => { events.push('report'); assert.equal(report.valid, true); assert.equal(report.clock.elapsedMs, 1000) },
    setup: async () => { events.push('setup'); return 'started' }
  })
  assert.equal(result, 'started')
  assert.deepEqual(events, ['report', 'setup'])
  assert.equal(f.waits(), 4)
})

test('forward and backward jumps are reported and prevent resource setup', async () => {
  for (const jump of [2000, -2000]) {
    const f = fixture(jump)
    let persisted, started = false
    await assert.rejects(capacitySetupAfterClockPreflight({
      observe: () => capacityClockPreflight(f.options),
      persistReport: async (r) => { persisted = r },
      setup: async () => { started = true }
    }), /clock preflight failed/)
    assert.equal(started, false)
    assert.equal(persisted.valid, false)
    assert.equal(persisted.clock.firstInvalidSample.driftMs, jump)
    assert.equal(persisted.clock.toleranceMs, 1000)
    assert.equal(f.waits(), 2)
  }
})

test('invalid or reversing clock observations cannot authorize setup', async () => {
  for (const invalid of ['wall-nan', 'mono-nan', 'reversed']) {
    let wall = 100000, mono = 100, waits = 0
    const report = await capacityClockPreflight({
      durationMs: 1000, sampleIntervalMs: 250,
      wallNow: () => wall, monotonicNow: () => mono,
      wait: async () => {
        waits++
        wall += 250; mono += 250
        if (waits === 2) {
          if (invalid === 'wall-nan') wall = NaN
          if (invalid === 'mono-nan') mono = NaN
          if (invalid === 'reversed') mono -= 350
        }
      }
    })
    assert.equal(report.valid, false, invalid)
    assert.equal(report.failure, 'invalid-clock-observation')
  }
})

test('an unwritable evidence report prevents setup even if the clock is healthy', async () => {
  let started = false
  await assert.rejects(capacitySetupAfterClockPreflight({
    observe: () => capacityClockPreflight(fixture().options),
    persistReport: async () => { throw new Error('disk unavailable') },
    setup: async () => { started = true }
  }), /disk unavailable/)
  assert.equal(started, false)
})
