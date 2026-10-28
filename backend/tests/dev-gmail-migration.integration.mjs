import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { sandbox } from './helpers/database.mjs'
import { planGmailAccounts } from '../scripts/dev-gmail-migration-plan.mjs'
import { applyGmailPlan } from '../scripts/dev-gmail-migration-apply.mjs'

test('development Gmail migration preserves account and listing ownership, updates email identity, and clears pending codes', async () => {
  const db = await sandbox()
  try {
    const seller = await db.client.account.create({ data: {
      loginName: 'v2-stress-r2_seller_1@test.com', displayName: 'Seller'
    } })
    const emailAccount = await db.client.account.create({ data: {
      loginName: 'bazaar.dev.test123@gmail.com', displayName: 'Email User'
    } })
    await db.client.accountIdentity.create({ data: {
      accountId: seller.id, provider: 'email',
      subject: seller.loginName, email: seller.loginName,
      verifiedAt: new Date(), verificationSource: 'email_delivery'
    } })
    await db.client.gmailClaim.create({ data: {
      key: 'bazaardevtest123@gmail.com', accountId: emailAccount.id
    } })
    await db.client.accountIdentity.create({ data: {
      accountId: emailAccount.id, provider: 'email',
      subject: emailAccount.loginName, email: emailAccount.loginName
    } })
    const listing = await db.client.listing.create({ data: {
      sellerId: seller.id, type: 'physical', title: 'Test', description: 'Test',
      category: 'test', priceAmount: '10', currency: 'USD'
    } })
    await db.client.emailCodeChallenge.create({ data: {
      key: randomBytes(32).toString('hex'), email: emailAccount.loginName,
      purpose: 'login', codeHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 60_000)
    } })
    const plan = planGmailAccounts([seller, emailAccount])
    await applyGmailPlan(db.client, plan)
    assert.equal((await db.client.account.findUniqueOrThrow({ where: { id: seller.id } })).loginName,
      'v2.stress.r2.seller.1@gmail.com')
    assert.equal((await db.client.listing.findUniqueOrThrow({ where: { id: listing.id } })).sellerId,
      seller.id)
    const migratedIdentity = await db.client.accountIdentity.findUniqueOrThrow({
      where: { accountId_provider: { accountId: seller.id, provider: 'email' } }
    })
    assert.equal(migratedIdentity.subject, 'v2.stress.r2.seller.1@gmail.com')
    assert.equal(migratedIdentity.verifiedAt, null)
    assert.equal(migratedIdentity.verificationSource, null)
    const migrationEvent = await db.client.accountIdentityEvent.findFirstOrThrow({
      where: { accountId: seller.id, action: 'migration' }
    })
    assert.equal(migrationEvent.previousEmail, 'v2-stress-r2_seller_1@test.com')
    assert.equal(migrationEvent.currentEmail, 'v2.stress.r2.seller.1@gmail.com')
    assert.equal(migrationEvent.verificationSource, 'unknown')
    assert.equal((await db.client.accountIdentity.findUniqueOrThrow({
      where: { accountId_provider: { accountId: emailAccount.id, provider: 'email' } }
    })).subject, 'bazaar.dev.test123@gmail.com')
    assert.equal((await db.client.gmailClaim.findUniqueOrThrow({
      where: { key: 'bazaardevtest123@gmail.com' }
    })).accountId, emailAccount.id)
    assert.equal(await db.client.gmailClaim.count({
      where: { key: 'bazaardevtest123@gmail.com' }
    }), 1)
    assert.equal(await db.client.emailCodeChallenge.count(), 0)
  } finally { await db.close() }
})
