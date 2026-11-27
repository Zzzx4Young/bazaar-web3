import assert from 'node:assert/strict'
import test from 'node:test'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
import { validateBudget } from '../dist/delivery-files/quota.service.js'
const runtime = {
  image: 'sha256:' + 'a'.repeat(64),
  memoryBytes: 4_000_000_000,
  cpus: 1,
  pids: 32,
  tmpBytes: 2_200_000_000,
  wallSeconds: 120
}
test('R06 product checker admits bounded 2.2GB tmpfs within the 4GB cgroup', () => {
  assert.doesNotThrow(() => new DockerFileChecker(runtime))
  assert.throws(() => new DockerFileChecker({ ...runtime, tmpBytes: 2_200_000_001 }))
  assert.throws(
    () =>
      new DockerFileChecker({
        ...runtime,
        tmpBytes: 1_000_000,
        memoryBytes: 128_000_000,
        wallSeconds: 121
      })
  )
})
test('R06 service admission never reserves more than two scanner slots', () => {
  const budget = {
    globalBytes: 8_000_000_000,
    globalUploads: 8,
    checkConcurrency: 2,
    checkQueue: 4
  }
  assert.doesNotThrow(() => validateBudget(budget))
  assert.throws(() => validateBudget({ ...budget, checkConcurrency: 3 }))
})
