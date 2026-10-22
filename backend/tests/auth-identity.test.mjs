import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { codeDigest, createEmailCode, emailCodeMessage, normalizeGmail } from '../dist/auth/email-code.js'
import { GoogleOidcClient } from '../dist/auth/google-client.js'

test('email code is six digits including possible leading zeros and bound to challenge identity', () => {
  const code = createEmailCode(() => 42)
  assert.equal(code, '000042')
  const key = Buffer.alloc(32, 7)
  const digest = codeDigest(key, 'challenge-1', 'user@gmail.com', 'login', code)
  assert.equal(digest.length, 64)
  assert.notEqual(digest, code)
  assert.notEqual(digest, codeDigest(key, 'challenge-2', 'user@gmail.com', 'login', code))
  assert.notEqual(digest, codeDigest(key, 'challenge-1', 'user@gmail.com', 'bind', code))
  assert.notEqual(digest, codeDigest(key, 'challenge-1', 'other@gmail.com', 'login', code))
  assert.notEqual(digest, createHmac('sha256', key).update(code).digest('hex'))
})

test('Gmail input is normalized and other domains are rejected', () => {
  assert.equal(normalizeGmail('  User.Name@gmail.com  '), 'user.name@gmail.com')
  assert.throws(() => normalizeGmail('user@example.com'), /INVALID_INPUT/)
  assert.throws(() => normalizeGmail('not-an-email'), /INVALID_INPUT/)
})

test('email templates identify purpose and expiry without including a login link', () => {
  const message = emailCodeMessage('zh-CN', 'bind', '123456')
  assert.match(message.subject, /绑定/)
  assert.match(message.text, /123456/)
  assert.match(message.text, /5 分钟/)
  assert.doesNotMatch(message.text, /https?:\/\//)
})

test('Google token verification rejects wrong audience, nonce and unverified email', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' }
  let claims = {}
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/certs')) return { ok: true, json: async () => ({ keys: [jwk] }) }
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: 'client-id', sub: 'google-sub',
      email: 'user@gmail.com', email_verified: true, nonce: 'expected-nonce',
      exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000),
      ...claims
    })).toString('base64url')
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey)
      .toString('base64url')
    return { ok: true, json: async () => ({ id_token: `${header}.${payload}.${signature}` }) }
  }
  try {
    const client = new GoogleOidcClient({ clientId: 'client-id', clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/api/auth/google/callback' })
    assert.equal((await client.exchange({ code: 'x', verifier: 'v', nonce: 'expected-nonce' })).sub,
      'google-sub')
    for (claims of [{ aud: 'other' }, { nonce: 'other' }, { email_verified: false },
      { email: 'user@other.com' }, { exp: 0 }]) {
      await assert.rejects(client.exchange({ code: 'x', verifier: 'v', nonce: 'expected-nonce' }))
    }
  } finally { globalThis.fetch = originalFetch }
})
