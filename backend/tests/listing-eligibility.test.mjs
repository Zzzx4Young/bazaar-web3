import assert from 'node:assert/strict'
import test from 'node:test'
import { ListingService } from '../dist/listings/listing.service.js'
import { Prisma } from '../dist/generated/prisma/client.js'

const config = { chainId: 11155111, token: '0x' + '1'.repeat(40), escrow: '0x' + '2'.repeat(40) }
const wallet = '0x' + '3'.repeat(40)
const identity = { chainId: config.chainId, address: wallet, bindingVersion: 3 }
const payout = { chainId: config.chainId, wallet, escrow: config.escrow, bindingVersion: 3 }
const row = {
  id: '11111111-1111-4111-8111-111111111111', type: 'digital', saleMode: 'one_off',
  listingSeller: { id: 'seller', displayName: 'Seller', walletIdentities: [identity], payoutConfirmations: [payout] },
  version: 2, testnetPrices: [{ ...config, listingVersion: 2, amountAtoms: '1' }],
  priceAmount: new Prisma.Decimal('1'), currency: 'USD', reviewStatus: 'clear',
  commitmentVersion: 1, commitment: { resourceMode: 'file' },
  inventoryListingRows: [], digitalInventoryRows: [{ availability: 'available' }],
  mediaRows: [], _count: { orderListingRows: 0 }
}
for (const [name, sellerPatch, pricePatch, deployment, reason] of [
  ['current confirmation', {}, {}, config, null],
  ['unbound wallet', { walletIdentities: [{ ...identity, address: null }] }, {}, config, 'payout_unconfirmed'],
  ['unknown wallet', { walletIdentities: [] }, {}, config, 'payout_unconfirmed'],
  ['missing confirmation', { payoutConfirmations: [] }, {}, config, 'payout_unconfirmed'],
  ['old binding version', { payoutConfirmations: [{ ...payout, bindingVersion: 1 }] }, {}, config, 'payout_unconfirmed'],
  ['other wallet', { payoutConfirmations: [{ ...payout, wallet: config.token }] }, {}, config, 'payout_unconfirmed'],
  ['other chain', { payoutConfirmations: [{ ...payout, chainId: 31337 }] }, {}, config, 'payout_unconfirmed'],
  ['other escrow', { payoutConfirmations: [{ ...payout, escrow: config.token }] }, {}, config, 'payout_unconfirmed'],
  ['old price version', {}, { listingVersion: 1 }, config, 'price_unavailable'],
  ['other token price', {}, { token: config.escrow }, config, 'price_unavailable'],
  ['disabled deployment', {}, {}, null, 'testnet_unavailable']
]) {
  test(`public testnet eligibility: ${name}`, async () => {
    // Storage is the boundary; exercise the real public mapper without a database.
    const listing = { ...row, listingSeller: { ...row.listingSeller, ...sellerPatch },
      testnetPrices: [{ ...row.testnetPrices[0], ...pricePatch }] }
    const service = new ListingService({ listing: { findFirst: async () => listing } }, null, 'compat', deployment)
    const view = await service.detail(row.id)
    assert.equal(view.testnetPurchaseEligible, reason === null)
    assert.equal(view.testnetPurchaseBlockReason, reason)
    assert.deepEqual(view.seller, { id: 'seller', displayName: 'Seller' })
    assert.ok(!JSON.stringify(view).includes('bindingVersion'))
  })
}
