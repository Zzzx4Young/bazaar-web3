import assert from 'node:assert/strict'
import { provisionAccounts } from '../dist/accounts/provision-accounts.js'
import { currencyCodes } from '../dist/pricing/currencies.js'

export const alphaE2EAccounts = {
  seller: 'seller_alpha@test.com',
  buyer: 'buyer_alpha@test.com'
}

export const alphaE2ECategories = [
  'electronics',
  'digital_assets',
  'software_source',
  'game_items',
  'secondhand_fashion'
]

const usdFactors = {
  USD: '1',
  EUR: '1.08',
  GBP: '1.27',
  JPY: '0.0067',
  CNY: '0.14',
  CAD: '0.74',
  AUD: '0.66',
  CHF: '1.13',
  HKD: '0.128',
  SGD: '0.75',
  KRW: '0.00074',
  INR: '0.012',
  AED: '0.272',
  BRL: '0.20',
  BTC: '65000',
  ETH: '3500',
  USDT: '1',
  USDC: '1',
  SOL: '150'
}

export async function seedAlphaE2E(client, password) {
  assert.deepEqual(Object.keys(usdFactors).sort(), [...currencyCodes].sort())
  await provisionAccounts(client, [
    { loginName: alphaE2EAccounts.seller, displayName: 'Alpha Seller', password },
    { loginName: alphaE2EAccounts.buyer, displayName: 'Alpha Buyer', password }
  ])
  const fetchedAt = new Date()
  const quote = await client.rateSnapshot.create({
    data: {
      provider: 'Alpha E2E deterministic rates',
      rates: usdFactors,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + 60 * 60 * 1000)
    }
  })
  return { accounts: alphaE2EAccounts, categories: alphaE2ECategories, quoteId: quote.id }
}
