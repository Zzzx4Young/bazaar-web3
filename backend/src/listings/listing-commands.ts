import { type PrismaClient } from '../generated/prisma/client.js'
import { DomainError } from '../common/domain-error.js'
import { parseStoredAmount } from '../common/money.js'
import { transact, type TransactionOptions } from '../database/transaction.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'
import { lockListing } from './listing-lock.js'
import { lockMediaAssets } from '../media/lock-media-assets.js'

export class ListingCommands {
  constructor(private readonly client: PrismaClient) {}

  async edit(
    actorId: string,
    listingId: string,
    version: number,
    patch: {
      title?: string
      description?: string
      category?: string
      priceAmount?: string
      licenseDescription?: string
      contentVersion?: string
      mediaIds?: string[]
      publicationStatus?: 'published' | 'withdrawn'
    },
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
        if (listing.saleMode === 'one_off' &&
          Object.keys(patch).some((key) => key !== 'publicationStatus') &&
          (await tx.order.count({ where: { listingId } })) > 0)
          throw new DomainError('LISTING_CONFLICT')
        if (patch.mediaIds) {
          await lockMediaAssets(tx, patch.mediaIds)
          const assets = await tx.mediaAsset.findMany({ where: { id: { in: patch.mediaIds } } })
          if (assets.some((asset) => asset.sellerId !== actorId)) throw new DomainError('FORBIDDEN')
          if (assets.length !== patch.mediaIds.length ||
            assets.some((asset) => asset.status !== 'ready')) throw new DomainError('INVALID_INPUT')
          if (await tx.listingMedia.count({
            where: { mediaId: { in: patch.mediaIds }, listingId: { not: listingId } }
          })) throw new DomainError('LISTING_CONFLICT')
          await tx.listingMedia.deleteMany({ where: { listingId } })
          await tx.listingMedia.createMany({ data: patch.mediaIds.map((mediaId, position) => ({
            listingId, mediaId, position
          })) })
        }
        return tx.listing.update({
          where: { id: listingId },
          data: {
            title: patch.title,
            description: patch.description,
            category: patch.category,
            licenseDescription: patch.licenseDescription,
            contentVersion: patch.contentVersion,
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
