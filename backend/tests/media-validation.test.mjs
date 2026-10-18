import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { validateImageBytes } from '../dist/media/media-policy.js'

const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex')

test('verified PNG bytes cannot be attached under a forged JPEG type', () => {
  assert.equal(validateImageBytes(png, 'image/png'), true)
  assert.equal(validateImageBytes(png, 'image/jpeg'), false)
})

test('HTML with an image MIME claim is rejected', () => {
  assert.equal(validateImageBytes(Buffer.from('<script>alert(1)</script>'), 'image/png'), false)
})
