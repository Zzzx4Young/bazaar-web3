import assert from 'node:assert/strict'
import test from 'node:test'
import * as diagnosticModule from '../scripts/capacity-diagnostics.mjs'
import { capacityFailureSamples, capacityHttpError, capacityDiagnosticPolicy } from '../scripts/capacity-diagnostics.mjs'

test('request timeline locates backlog and the first slow request by completion second', () => {
  assert.equal(typeof diagnosticModule.capacityRequestTimeline, 'function')
  const timeline = diagnosticModule.capacityRequestTimeline()
  timeline.start({ elapsedMs: 900, kind: 'search', active: 1 })
  timeline.start({ elapsedMs: 1100, kind: 'write', active: 2 })
  timeline.finish({ elapsedMs: 1350, kind: 'search', durationMs: 450, failed: false })
  timeline.finish({ elapsedMs: 2200, kind: 'write', durationMs: 1100, failed: true })

  assert.deepEqual(timeline.report(), [
    { second: 0, started: 1, completed: 0, failed: 0, peakActive: 1, inFlightEnd: 1,
      kinds: { search: { started: 1, completed: 0, failed: 0, maxDurationMs: 0 } } },
    { second: 1, started: 1, completed: 1, failed: 0, peakActive: 2, inFlightEnd: 1,
      kinds: {
        search: { started: 0, completed: 1, failed: 0, maxDurationMs: 450 },
        write: { started: 1, completed: 0, failed: 0, maxDurationMs: 0 }
      } },
    { second: 2, started: 0, completed: 1, failed: 1, peakActive: 0, inFlightEnd: 0,
      kinds: { write: { started: 0, completed: 1, failed: 1, maxDurationMs: 1100 } } }
  ])
})

test('repeated early read failures cannot crowd out later write and authentication samples', () => {
  const diagnostics = capacityFailureSamples()
  const error = capacityHttpError({ status: 503, value: { code: 'OVERLOADED' }, apiIndex: 1 }, 'Read failed')
  for (let index = 0; index < 100; index++)
    diagnostics.record('search:HTTP_503', { index, elapsedMs: index, kind: 'search', error })
  diagnostics.record('write:WRITE_PHASE_IN_FLIGHT', { index: 100, elapsedMs: 100, kind: 'write',
    error: { name: 'Error', code: 'WRITE_PHASE_IN_FLIGHT' } })
  diagnostics.record('auth-login:HTTP_429', { index: 101, elapsedMs: 101, kind: 'auth-login',
    error: capacityHttpError({ status: 429, value: { code: 'RATE_LIMITED' } }, 'Login failed') })
  assert.equal(diagnostics.samples.length, capacityDiagnosticPolicy.samplesPerError + 2)
  assert.equal(diagnostics.samples[0].responseCode, 'OVERLOADED')
  assert.equal(diagnostics.samples[0].apiIndex, 1)
  assert.equal(diagnostics.samples.at(-1).responseCode, 'RATE_LIMITED')
})

test('diagnostics have a global bound and omit raw private fields', () => {
  const diagnostics = capacityFailureSamples()
  const error = capacityHttpError({ status: 503, value: { code: 'private-secret', token: 'private-token' } }, 'private-message')
  for (let index = 0; index < 200; index++)
    diagnostics.record(`failure-${index}`, { index, elapsedMs: index, kind: 'search', error,
      payload: 'private-payload' })
  assert.equal(diagnostics.samples.length, capacityDiagnosticPolicy.maxSamples)
  assert.equal(JSON.stringify(diagnostics.samples).includes('private'), false)
})
