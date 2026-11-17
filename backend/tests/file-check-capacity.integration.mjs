import assert from 'node:assert/strict'
import test from 'node:test'
import { sampleFileCapacity } from '../scripts/sample-file-capacity.mjs'

test(
  'R06 full decimal limit objects and bounded concurrency capacity',
  {
    skip: !process.env.PRIVATE_FILE_CAPACITY_SAMPLES,
    timeout: 2_000_000
  },
  async () => {
    const result = await sampleFileCapacity(
      process.env.PRIVATE_FILE_CAPACITY_SAMPLES,
      process.env.PRIVATE_FILE_CHECK_IMAGE
    )
    const failures = []
    for (const row of result.rows) {
      if (!row.observation.removed)
        failures.push(`${row.sample.name}: container removal unconfirmed`)
      if (row.sample.delta <= 0) {
        if (row.report?.status !== 'clean')
          failures.push(`${row.sample.name}: ${row.report?.reason ?? row.exception}`)
      } else if (row.sample.kind === 'zip') {
        assert.equal(row.exception, 'Invalid private checker input')
        assert.equal(row.report, undefined)
      } else {
        assert.equal(row.report?.status, 'rejected')
        assert.equal(row.report.reason, 'FILE_SIZE')
      }
    }
    assert.deepEqual(
      failures,
      [],
      'Capacity blockers: actual full in-limit objects must scan clean; report failures without weakening limits'
    )
  }
)
