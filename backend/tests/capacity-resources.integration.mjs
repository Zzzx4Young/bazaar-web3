import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityResources } from '../scripts/capacity-resources.mjs'
import { sandbox, testUrl } from './helpers/database.mjs'

test('capacity resource wait samples execute against PostgreSQL', async () => {
  const db = await sandbox(testUrl(), false)
  try {
    const stop = await capacityResources([], db.client, db.url.username)
    const report = await stop()
    assert.equal(report.failedSamples, false)
    assert.ok(report.samples.length >= 2)
    for (const sample of report.samples) {
      for (const field of ['activeNoWait', 'ioWaiting', 'lwlockWaiting']) {
        assert.ok(Number.isSafeInteger(sample[field]))
        assert.ok(sample[field] >= 0)
      }
    }
  } finally {
    await db.close()
  }
})
