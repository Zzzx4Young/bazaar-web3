import assert from 'node:assert/strict'
import test from 'node:test'
import { planGmailAccounts } from '../scripts/dev-gmail-migration-plan.mjs'

test('development login-name plan preserves account IDs and converts legacy prefixes', () => {
  const rows = [
    { id: 'seller-id', loginName: 'v2-stress-r2_seller_1@test.com' },
    { id: 'plain-id', loginName: 'old-user' },
    { id: 'gmail-id', loginName: 'bazaar.dev.abcd1234@gmail.com' }
  ]
  assert.deepEqual(planGmailAccounts(rows), [
    { id: 'seller-id', from: rows[0].loginName, to: 'v2.stress.r2.seller.1@gmail.com',
      key: 'v2stressr2seller1@gmail.com' },
    { id: 'plain-id', from: 'old-user', to: 'old.user@gmail.com', key: 'olduser@gmail.com' },
    { id: 'gmail-id', from: rows[2].loginName, to: 'bazaar.dev.abcd1234@gmail.com',
      key: 'bazaardevabcd1234@gmail.com' }
  ])
})

test('development login-name plan rejects aliases and unexpected domains', () => {
  assert.throws(() => planGmailAccounts([
    { id: 'one', loginName: 'seller_one@test.com' },
    { id: 'two', loginName: 'seller.one@test.com' }
  ]), /collision/)
  assert.throws(() => planGmailAccounts([
    { id: 'one', loginName: 'real@example.com' }
  ]), /Unexpected/)
  assert.throws(() => planGmailAccounts([
    { id: 'one', loginName: 'other-person@gmail.com' }
  ]), /Gmail address/)
  assert.throws(() => planGmailAccounts([
    { id: 'one', loginName: 'other_person@gmail.com' }
  ]), /Gmail address/)
})
