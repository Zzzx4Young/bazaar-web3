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

test('resource samples expose each owned API process before a capacity failure', async () => {
  const client = {
    $queryRaw: async () => [{ total: 1, active: 0, syncWaiting: 0, lockWaiting: 0,
      ioWaiting: 0, lwlockWaiting: 0, activeNoWait: 0 }]
  }
  const processHandle = { pid: process.pid, exitCode: null, signalCode: null }
  const stop = await capacityResources([processHandle], client, 'fixture')
  const report = await stop()
  assert.equal(report.failedSamples, false)
  assert.ok(report.samples.length >= 2)
  for (const sample of report.samples) {
    assert.equal(sample.apiProcesses.length, 1)
    assert.equal(sample.apiProcesses[0].pid, process.pid)
    assert.ok(sample.apiProcesses[0].rssBytes > 0)
    assert.ok(Number.isFinite(sample.apiProcesses[0].cpuSeconds))
  }
})
