import { readFileSync } from 'node:fs'
import { DatabaseService } from '../dist/database/database.service.js'
import { pendingPaymentAgeMs } from '../dist/orders/order-expiry-policy.js'
import { assertLoopbackDatabaseUrl } from './v2-seed.mjs'

const url = process.env.DATABASE_URL ?? readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim()
assertLoopbackDatabaseUrl(url)
const apply = process.argv.includes('--apply')
const before = new Date(Date.now() - pendingPaymentAgeMs)
const db = new DatabaseService(url)

function isLegacyUnreserved(order) {
  const listing = order.orderListing
  const inventory = listing.inventoryListingRows[0]
  return order.status === 'pending_payment' && order.createdAt < before &&
    listing.type === 'physical' &&
    /^V2 physical listing \d{3} · [a-z_]+$/.test(listing.title) &&
    listing.description.startsWith('V2 seeded description ') &&
    inventory?.availability === 'available' && inventory.activeOrderId === null &&
    order.reservationOrderRows.length === 0 &&
    order.snapshot?.settlementSnapshotRows.length === 0
}

const include = {
  orderListing: {
    include: {
      inventoryListingRows: true
    }
  },
  reservationOrderRows: true,
  snapshot: { include: { settlementSnapshotRows: true } }
}

await db.onModuleInit()
try {
  const inspected = await db.client.order.findMany({
    where: { status: 'pending_payment', createdAt: { lt: before },
      orderListing: { title: { startsWith: 'V2 physical listing ' } } },
    include
  })
  const candidates = inspected.filter(isLegacyUnreserved)
  let updated = 0
  if (apply) {
    for (const candidate of candidates) {
      await db.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${candidate.listingId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`
        const current = await tx.order.findUniqueOrThrow({ where: { id: candidate.id }, include })
        if (!isLegacyUnreserved(current)) return
        await tx.order.update({ where: { id: current.id }, data: {
          status: 'expired', version: { increment: 1 }
        } })
        await tx.orderEvent.create({ data: {
          orderId: current.id, actorId: null, operation: 'expire',
          fromState: 'pending_payment', toState: 'expired',
          requestId: `system-expire-${current.id}`
        } })
        updated++
      })
    }
  }
  console.log(JSON.stringify({ scope: 'unreserved V2 physical test orders',
    inspected: inspected.length,
    seedDescriptionMatch: inspected.filter((order) =>
      order.orderListing.description.startsWith('V2 seeded description ')).length,
    unreserved: inspected.filter((order) =>
      order.orderListing.inventoryListingRows[0]?.availability === 'available' &&
      order.reservationOrderRows.length === 0).length,
    candidates: candidates.length, updated }))
} finally {
  await db.onModuleDestroy()
}
