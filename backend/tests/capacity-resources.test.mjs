import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityResources } from '../scripts/capacity-resources.mjs'

test('resource samples retain expected connection outages and reject SQL defects', async () => {
  for (const [code, expectedFailed] of [
    ['P1001', false],
    ['42601', true]
  ]) {
    let broken = false
    const client = {
      $queryRaw: async () => {
        if (broken) {
          const error = new Error('Private database diagnostic')
          error.code = code
          throw error
        }
        return [{ total: 2, active: 0 }]
      }
    }
    const stop = await capacityResources([], client, 'fixture', 'single', () => true)
    broken = true
    const report = await stop()
    assert.equal(report.failedSamples, expectedFailed)
    assert.equal(report.unavailableSamples.length, 1)
    assert.equal(report.unavailableSamples[0].expected, !expectedFailed)
    assert.equal(JSON.stringify(report).includes('Private database diagnostic'), false)
    assert.equal(report.clock.valid, true)
    assert.ok(report.clock.sampleCount >= 2)
  }
})
