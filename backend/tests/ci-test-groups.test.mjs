import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { partitionIntegrationTests, requirePrivateChecks } from '../scripts/ci-test-groups.mjs'

test('CI partitions every database integration file exactly once, independent of directory order', async () => {
  const files = (await readdir(new URL('./', import.meta.url))).filter((f) => f.endsWith('.integration.mjs'))
  const groups = partitionIntegrationTests(files)
  const assigned = Object.values(groups).flat()
  assert.deepEqual([...assigned].sort(), [...files].sort())
  assert.equal(new Set(assigned).size, files.length)
  assert.deepEqual(partitionIntegrationTests([...files].reverse()), groups)
  assert.ok(groups['private-files'].includes('file-check-product-capacity.integration.mjs'))
  assert.ok(groups['database-a'].length > 0 && groups['database-b'].length > 0)
})

test('mandatory private checks fail before execution when any actual dependency is missing', () => {
  assert.throws(() => requirePrivateChecks({}), /Missing required private-file check configuration/)
  const env = Object.fromEntries(['PRIVATE_FILE_CHECK_IMAGE', 'PRIVATE_FILE_CONTROL_IMAGE',
    'PRIVATE_FILE_CAPACITY_SAMPLES', 'PRIVATE_GARAGE_ENDPOINT', 'PRIVATE_GARAGE_BUCKET',
    'PRIVATE_GARAGE_ACCESS_KEY_ID', 'PRIVATE_GARAGE_SECRET_KEY'].map((key) => [key, 'test-only']))
  requirePrivateChecks(env)
  for (const key of Object.keys(env)) assert.throws(() => requirePrivateChecks({ ...env, [key]: '' }))
})
