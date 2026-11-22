import assert from 'node:assert/strict'
import test from 'node:test'
import { recoveryAuthorizationWindow } from './helpers/recovery-authorization-window.mjs'
test('controlled recovery authorization never exceeds the 300-second guard across a millisecond tick', () => {
  let time = 1_700_000_000_000
  const window = recoveryAuthorizationWindow(() => time++)
  assert.equal(Date.parse(window.expiresAt) - Date.parse(window.issuedAt), 300000)
})
