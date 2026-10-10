import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('watchdog startup defaults to required and permits only explicit local exemptions', () => {
  const script = fileURLToPath(new URL('../../infra/ha/test_watchdog_policy.py', import.meta.url))
  const result = spawnSync('python3', ['-B', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
