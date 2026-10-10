import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLogin, validatePassword } from '../dist/auth/password.js'

test('password limits count Unicode characters and retain existing boundaries', () => {
  for (const value of ['a'.repeat(15), 'a'.repeat(128), '😀'.repeat(15), '😀'.repeat(128)])
    assert.doesNotThrow(() => validatePassword(value))
  for (const value of ['a'.repeat(14), 'a'.repeat(129), '😀'.repeat(14), '😀'.repeat(129)])
    assert.throws(() => validatePassword(value), error => error.code === 'INVALID_INPUT')
})

test('login normalization retains handle grammar and maximum email length', () => {
  assert.equal(normalizeLogin('  Buyer_123  '), 'buyer_123')
  assert.equal(normalizeLogin('a'.repeat(64)), 'a'.repeat(64))
  assert.throws(() => normalizeLogin('a'.repeat(65)), error => error.code === 'INVALID_INPUT')
  const email = 'a'.repeat(64) + '@' + 'b'.repeat(31) + '.com'
  assert.equal(email.length, 100)
  assert.equal(normalizeLogin(email), email)
  assert.throws(() => normalizeLogin(email.replace('.com', 'b.com')),
    error => error.code === 'INVALID_INPUT')
})
