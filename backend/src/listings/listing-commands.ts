import { type PrismaClient } from '../generated/prisma/client.js'
import { DomainError } from '../common/domain-error.js'
import { parseStoredAmount } from '../common/money.js'
import { transact, type TransactionOptions } from '../database/transaction.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'
import { lockListing } from './listing-lock.js'

export class ListingCommands {
  constructor(private readonly client: PrismaClient) {}

  async edit(
    actorId: string,
    listingId: string,
    version: number,
    patch: { title?: string; priceAmount?: string; publicationStatus?: 'published' | 'withdrawn' },
    options: TransactionOptions = {}
  ) {
    return transact(
      this.client,
      async (tx, attempt) => {
        await requireActiveAccount(tx, actorId)
        const listing = await lockListing(tx, listingId)
        await options.checkpoint?.('locked', tx, attempt)
        if (listing.sellerId !== actorId) throw new DomainError('FORBIDDEN')
        if (listing.version !== version) throw new DomainError('LISTING_CONFLICT')
        return tx.listing.update({
          where: { id: listingId },
          data: {
            title: patch.title,
            priceAmount:
              patch.priceAmount === undefined ? undefined : parseStoredAmount(patch.priceAmount),
            publicationStatus: patch.publicationStatus,
            version: { increment: 1 }
          }
        })
      },
      options
    )
  }
}
