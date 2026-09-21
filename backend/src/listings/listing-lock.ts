import { DomainError } from '../common/domain-error.js'
import { type Transaction } from '../database/transaction.js'

export async function lockListing(tx: Transaction, listingId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${listingId}::uuid FOR UPDATE`
  const listing = await tx.listing.findUnique({ where: { id: listingId } })
  if (!listing) throw new DomainError('NOT_FOUND')
  if (listing.type === 'physical') {
    await tx.$queryRaw`SELECT "listingId" FROM "PhysicalInventory" WHERE "listingId" = ${listingId}::uuid FOR UPDATE`
  } else if (listing.type === 'digital') {
    await tx.$queryRaw`SELECT "listingId" FROM "DigitalInventory" WHERE "listingId" = ${listingId}::uuid FOR UPDATE`
  }
  return listing
}
