import assert from 'node:assert/strict'
import { URL } from 'node:url'

export const V2_LISTING_COUNT = 100
export const V2_ORDER_COUNT = 60
export const V2_SEED_PREFIX = 'v2-stress'

const currencies = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'CAD',
  'AUD',
  'CHF',
  'HKD',
  'SGD',
  'KRW',
  'INR',
  'AED',
  'BRL',
  'BTC',
  'ETH',
  'USDT',
  'USDC',
  'SOL'
]
const categories = ['electronics', 'digital_assets', 'software_source', 'game_items', 'secondhand_fashion']
const orderStateSequence = [
  'pending_payment',
  'pending_delivery',
  'pending_acceptance',
  'issue',
  'completed',
  'refunded',
  'cancelled',
  'expired'
]
const usdFactors = {
  USD: '1', EUR: '1.08', GBP: '1.27', JPY: '0.0067', CNY: '0.14', CAD: '0.74', AUD: '0.66',
  CHF: '1.13', HKD: '0.128', SGD: '0.75', KRW: '0.00074', INR: '0.012', AED: '0.272',
  BRL: '0.20', BTC: '65000', ETH: '3500', USDT: '1', USDC: '1', SOL: '150'
}

export function assertLoopbackDatabaseUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    throw new Error('V2 seed requires a PostgreSQL loopback database')
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
    throw new Error('V2 seed requires a loopback database target')
  return url
}

function money(index) {
  if (index === 0) return { amount: '0', currency: 'USD' }
  const currency = currencies[index % currencies.length]
  if (currency === 'BTC') return { amount: '0.00012345', currency }
  if (currency === 'ETH') return { amount: '0.123456789012345678', currency }
  if (currency === 'USDT' || currency === 'USDC') return { amount: '12.345678', currency }
  if (currency === 'JPY' || currency === 'KRW') return { amount: String(100 + index), currency }
  return { amount: `${(index * 17.375 + 0.01).toFixed(2)}`, currency }
}

export function buildV2SeedPlan({ seed = V2_SEED_PREFIX } = {}) {
  const accounts = [
    ...Array.from({ length: 6 }, (_, index) => ({
      key: `seller${index + 1}`,
      loginName: `${seed}_seller_${index + 1}@test.com`,
      displayName: `V2 Seller ${index + 1}`
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      key: `buyer${index + 1}`,
      loginName: `${seed}_buyer_${index + 1}@test.com`,
      displayName: `V2 Buyer ${index + 1}`
    })),
    { key: 'admin', loginName: `${seed}_admin@test.com`, displayName: 'V2 Admin' },
    { key: 'observer', loginName: `${seed}_observer@test.com`, displayName: 'V2 Observer' }
  ]

  const listings = Array.from({ length: V2_LISTING_COUNT }, (_, index) => {
    const type = index % 2 === 0 ? 'physical' : 'digital'
    const publicationStatus =
      index < 70 ? 'published' : index < 80 ? 'withdrawn' : index < 90 ? 'draft' : 'archived'
    const price = money(index)
    const title =
      index === 1
        ? `超长中文标题 ${'边界测试'.repeat(30)} / ${'Unicode 🚀 '.repeat(12)}`
        : index === 2
          ? 'Zero price free sample — 免费体验 — Бесплатно — 無料'
          : `V2 ${type} listing ${String(index + 1).padStart(3, '0')} · ${categories[index % categories.length]}`
    return {
      key: `listing${index + 1}`,
      sellerKey: `seller${(index % 6) + 1}`,
      type,
      title,
      description: `V2 seeded description ${index + 1}. Markdown **bold**, emoji 🧪, and edge text: <>&/\\`,
      category: categories[index % categories.length],
      price,
      supplyMode: type === 'digital' ? (index % 4 === 1 ? 'single' : 'unlimited') : null,
      publicationStatus,
      inventoryState:
        type === 'digital'
          ? index % 4 === 1
            ? index % 12 === 9
              ? 'available'
              : index % 8 === 1
              ? 'sold'
              : index % 8 === 5
                ? 'refund_hold'
                : 'available'
            : 'unlimited'
          : index % 15 === 0
            ? 'sold'
            : index % 11 === 0
              ? 'reserved'
              : 'available'
    }
  })

  const orders = Array.from({ length: V2_ORDER_COUNT }, (_, index) => {
    const listing = listings[index]
    const baseStatus = orderStateSequence[index % orderStateSequence.length]
    return {
      key: `order${index + 1}`,
      listingKey: `listing${index + 1}`,
      buyerKey: `buyer${(index % 6) + 1}`,
      status: listing.supplyMode === 'single' && listing.inventoryState === 'sold' ? 'completed' : baseStatus,
      partialDelivery: index % 10 === 0,
      requestId: `${seed}-order-${index + 1}`
    }
  })

  return {
    seed,
    accounts,
    listings,
    orders,
    // Counts are intentionally derived from the plan so tests can detect sequence drift.
    orderStates: Object.fromEntries(
      orderStateSequence.map((state) => [state, orders.filter((order) => order.status === state).length])
    )
  }
}

function accountInput(account, password) {
  return { loginName: account.loginName, displayName: account.displayName, password }
}

export async function seedV2(client, { password = 'V2-Local-Test-Password-2026', seed = V2_SEED_PREFIX } = {}) {
  const plan = buildV2SeedPlan({ seed })
  const { provisionAccounts } = await import('../dist/accounts/provision-accounts.js')
  const createdAccounts = await provisionAccounts(client, plan.accounts.map((account) => accountInput(account, password)))
  assert.equal(createdAccounts, plan.accounts.length)
  const accountRows = await client.account.findMany({ where: { loginName: { startsWith: `${seed}_` } } })
  const accountByKey = new Map(plan.accounts.map((account) => [account.key, accountRows.find((row) => row.loginName === account.loginName)]))
  await client.rateSnapshot.create({
    data: {
      provider: 'V2 deterministic stress rates',
      rates: usdFactors,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  })
  const listingByKey = new Map()

  for (const spec of plan.listings) {
    const seller = accountByKey.get(spec.sellerKey)
    assert.ok(seller)
    const listing = await client.listing.create({
      data: {
        sellerId: seller.id,
        type: spec.type,
        title: spec.title,
        description: spec.description,
        category: spec.category,
        priceAmount: spec.price.amount,
        currency: spec.price.currency,
        publicationStatus: spec.publicationStatus,
        licenseDescription: spec.type === 'digital' ? 'V2 seeded license; redistribution prohibited.' : null,
        contentVersion: spec.type === 'digital' ? 'v2.0.0' : null
      }
    })
    listingByKey.set(spec.key, listing)
    if (spec.type === 'physical') {
      await client.physicalInventory.create({ data: { listingId: listing.id } })
      if (spec.inventoryState === 'sold')
        await client.physicalInventory.update({ where: { listingId: listing.id }, data: { availability: 'available' } })
    } else if (spec.supplyMode === 'single') {
      await client.digitalInventory.create({ data: { listingId: listing.id } })
    }
  }

  for (const spec of plan.orders) {
    const listing = listingByKey.get(spec.listingKey)
    const buyer = accountByKey.get(spec.buyerKey)
    const listingSpec = plan.listings.find((item) => item.key === spec.listingKey)
    const seller = accountByKey.get(listingSpec.sellerKey)
    assert.ok(listing && buyer && seller)
    const order = await client.order.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        status: spec.status,
        version: 2,
        ...(spec.status === 'expired' ? { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } : {}),
        snapshot: {
          create: {
            listingVersion: listing.version,
            title: listing.title,
            description: listing.description,
            type: listing.type,
            category: listing.category,
            priceAmount: listing.priceAmount,
            currency: listing.currency,
            licenseDescription: listing.licenseDescription,
            contentVersion: listing.contentVersion
          }
        },
        ...(listing.type === 'physical'
          ? { shipping: { create: { recipient: `V2 Recipient ${spec.key}`, contact: '13800000000', address: 'V2 Test Address 1' } } }
          : {})
      }
    })
    const needsReservation = listing.type === 'physical' && spec.status !== 'pending_payment'
    if (needsReservation) {
      const closed = ['completed', 'refunded', 'cancelled', 'expired'].includes(spec.status)
      const availability =
        spec.status === 'completed'
          ? 'sold'
          : spec.status === 'refunded'
            ? 'refund_hold'
            : ['pending_payment', 'cancelled', 'expired'].includes(spec.status)
              ? 'available'
              : 'reserved'
      await client.physicalInventory.update({ where: { listingId: listing.id }, data: { availability, activeOrderId: availability === 'available' ? null : order.id } })
      await client.inventoryReservation.create({ data: { listingId: listing.id, orderId: order.id, state: closed ? spec.status : 'active', closedAt: closed ? new Date() : null } })
    }
    if (listing.type === 'digital' && listingSpec.supplyMode === 'single') {
      const availability =
        spec.status === 'completed'
          ? 'sold'
          : spec.status === 'refunded'
            ? 'refund_hold'
            : ['pending_payment', 'cancelled', 'expired'].includes(spec.status)
              ? 'available'
              : 'reserved'
      await client.digitalInventory.update({
        where: { listingId: listing.id },
        data: { availability, activeOrderId: availability === 'available' ? null : order.id }
      })
    }
    if (!['pending_payment', 'cancelled', 'expired'].includes(spec.status) && Number(listing.priceAmount) > 0)
      await client.settlementRecord.create({ data: { orderId: order.id, operation: 'payment', amount: listing.priceAmount, currency: listing.currency } })
    if (['pending_acceptance', 'issue', 'completed', 'refunded'].includes(spec.status)) {
      await client.deliveryRecord.create({ data: { orderId: order.id, sellerId: seller.id, sequence: 1, kind: listing.type, reference: listing.type === 'digital' ? `https://example.com/v2/${spec.key}` : `V2-TRACK-${spec.key}`, carrier: listing.type === 'physical' ? 'V2 Carrier' : null, accessCode: listing.type === 'digital' ? `V2-${spec.key}` : null } })
      if (spec.partialDelivery)
        await client.deliveryRecord.create({ data: { orderId: order.id, sellerId: seller.id, sequence: 2, kind: listing.type, reference: `https://example.com/v2/${spec.key}/part-2`, accessCode: 'PART-2' } })
    }
    if (['issue', 'refunded'].includes(spec.status)) {
      const issue = await client.issueRecord.create({ data: { orderId: order.id, buyerId: buyer.id, sourceStatus: 'pending_acceptance', description: `V2 dispute for ${spec.key}: long issue text with 🧪 and multilingual details.`, status: spec.status === 'refunded' ? 'resolved' : 'open', resolvedAt: spec.status === 'refunded' ? new Date() : null } })
      await client.refundRequest.create({ data: { orderId: order.id, issueId: issue.id, requestedBy: buyer.id, status: spec.status === 'refunded' ? 'approved' : 'pending', ...(spec.status === 'refunded' ? { approvedBy: seller.id, approvedAt: new Date(), returnOutcome: listing.type === 'digital' ? 'digital' : 'returned' } : {}) } })
    }
    if (spec.status === 'refunded' && Number(listing.priceAmount) > 0)
      await client.settlementRecord.create({ data: { orderId: order.id, operation: 'refund', amount: listing.priceAmount, currency: listing.currency } })
    const transitions = spec.status === 'pending_payment' ? [['create', null, 'pending_payment']] : [['create', null, 'pending_payment'], [spec.status === 'cancelled' ? 'cancel' : spec.status === 'expired' ? 'expire' : 'pay', 'pending_payment', ['cancelled', 'expired'].includes(spec.status) ? spec.status : 'pending_delivery']]
    for (const [operation, fromState, toState] of transitions)
      await client.orderEvent.create({ data: { orderId: order.id, actorId: buyer.id, operation, fromState, toState, requestId: `${spec.requestId}-${operation}` } })
    if (['pending_acceptance', 'issue', 'completed', 'refunded'].includes(spec.status))
      await client.orderEvent.create({ data: { orderId: order.id, actorId: seller.id, operation: 'deliver', fromState: 'pending_delivery', toState: spec.status === 'refunded' ? 'pending_acceptance' : 'pending_acceptance', requestId: `${spec.requestId}-deliver` } })
    if (spec.status === 'issue')
      await client.orderEvent.create({ data: { orderId: order.id, actorId: buyer.id, operation: 'issue', fromState: 'pending_acceptance', toState: 'issue', requestId: `${spec.requestId}-issue` } })
    if (spec.status === 'refunded')
      for (const [operation, fromState, toState, actorId] of [['issue', 'pending_acceptance', 'issue', buyer.id], ['request_refund', 'issue', 'issue', buyer.id], ['refund', 'issue', 'refunded', seller.id]])
        await client.orderEvent.create({ data: { orderId: order.id, actorId, operation, fromState, toState, requestId: `${spec.requestId}-${operation}` } })
  }
  return { ...plan, createdAccounts, createdListings: listingByKey.size, createdOrders: plan.orders.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('Set V2_DATABASE_URL or DATABASE_URL')
  assertLoopbackDatabaseUrl(databaseUrl)
  const { DatabaseService } = await import('../dist/database/database.service.js')
  const db = new DatabaseService(databaseUrl)
  await db.onModuleInit()
  try {
    const result = await seedV2(db.client, { password: process.env.V2_SEED_PASSWORD })
    console.log(JSON.stringify({ seed: result.seed, accounts: result.createdAccounts, listings: result.createdListings, orders: result.createdOrders, orderStates: result.orderStates }))
  } finally {
    await db.onModuleDestroy()
  }
}
