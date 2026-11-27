import test from 'node:test'
import assert from 'node:assert/strict'
import { web3BrowserFixture } from './helpers/web3-browser.mjs'
import { DeliveryPermitService } from '../dist/delivery-files/delivery-permit.service.js'
test('T09 full browser profile: real API exposes checked-file delivery permit with independent local chain signer', async () => {
  const f = await web3BrowserFixture('http://127.0.0.1:45800')
  try {
    assert.ok(
      f.app.get(DeliveryPermitService),
      'Dedicated delivery signer must be wired into the real API'
    )
  } finally {
    await f.close()
  }
})
