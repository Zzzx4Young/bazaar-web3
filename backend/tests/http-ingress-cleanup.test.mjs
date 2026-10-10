import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanupHttpIngress } from '../scripts/http-ingress-environment.mjs'

test('failed proxy cleanup retains the recovery environment and cannot report clean', async () => {
  for (const scenario of ['down-failure', 'containers-remain']) {
    let disposed = false
    const result = await cleanupHttpIngress({
      compose: async command => {
        if (scenario === 'down-failure') throw new Error('Owned container removal failed')
        return { stdout: command === 'ps' ? 'remaining-container' : '' }
      },
      dispose: async () => { disposed = true }
    })
    assert.equal(result, false)
    assert.equal(disposed, false)
  }
})

test('proxy cleanup disposes the recovery file only after independently checking no containers remain', async () => {
  const calls = []
  const cleaned = await cleanupHttpIngress({
    compose: async (...args) => { calls.push(args); return { stdout: '' } },
    dispose: async () => { calls.push(['dispose']) }
  })
  assert.equal(cleaned, true)
  assert.deepEqual(calls, [['down', '--remove-orphans'], ['ps', '-a', '-q'], ['dispose']])
})
