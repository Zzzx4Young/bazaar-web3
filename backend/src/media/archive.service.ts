import { createHash, randomUUID } from 'node:crypto'
import { type PrismaClient } from '../generated/prisma/client.js'
import { GarageObjectStore } from './garage-object-store.js'
import { mediaMaxBytes } from './media-policy.js'

const dayMs = 24 * 60 * 60 * 1000
const leaseMs = 5 * 60 * 1000

export function readArchiveDays(value: string | undefined): number {
  if (value === undefined) return 90
  if (!/^[1-9][0-9]{0,3}$/.test(value) || Number(value) > 3650)
    throw new Error('ORDER_IMAGE_ARCHIVE_AFTER_DAYS must be an integer from 1 to 3650')
  return Number(value)
}

export class ArchiveService {
  constructor(
    private readonly client: PrismaClient,
    private readonly store: GarageObjectStore,
    private readonly days: number,
    private readonly onFailure?: (item: { orderId: string; mediaId: string }, error: unknown) => void
  ) {
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('Invalid archive days')
  }

  async runOnce(now = new Date(), limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid archive batch limit')
    const cutoff = new Date(now.getTime() - this.days * dayMs)
    const candidates = await this.client.orderMediaSnapshot.findMany({
      where: {
        storageTier: 'hot',
        order: { status: 'completed', completedAt: { lte: cutoff } },
        OR: [{ archiveClaimedUntil: null }, { archiveClaimedUntil: { lt: now } }]
      },
      orderBy: [{ order: { completedAt: 'asc' } }, { orderId: 'asc' }, { position: 'asc' }],
      take: limit,
      select: { orderId: true, mediaId: true }
    })
    let archived = 0, failed = 0
    for (const candidate of candidates) {
      const token = randomUUID()
      const key = { orderId: candidate.orderId, mediaId: candidate.mediaId }
      const claim = await this.client.orderMediaSnapshot.updateMany({
        where: {
          ...key,
          storageTier: 'hot',
          OR: [{ archiveClaimedUntil: null }, { archiveClaimedUntil: { lt: now } }]
        },
        data: { archiveClaimToken: token, archiveClaimedUntil: new Date(now.getTime() + leaseMs) }
      })
      if (claim.count !== 1) continue
      try {
        const media = await this.client.mediaAsset.findUniqueOrThrow({ where: { id: key.mediaId } })
        if (!media.hotKey || !media.sha256 || !media.actualBytes) throw new Error('Unverified asset')
        const hot = await this.store.readHot(media.hotKey, mediaMaxBytes + 1)
        const digest = createHash('sha256').update(hot.bytes).digest('hex')
        if (digest !== media.sha256 || hot.bytes.length !== media.actualBytes ||
          hot.contentType !== media.contentType) throw new Error('Hot object verification failed')
        const coldKey = media.coldKey ?? `archive/${media.id}/${media.sha256}`
        if (!media.coldKey) await this.store.putCold(coldKey, hot.bytes, media.contentType)
        const cold = await this.store.readCold(coldKey, mediaMaxBytes + 1)
        if (cold.bytes.length !== media.actualBytes ||
          createHash('sha256').update(cold.bytes).digest('hex') !== media.sha256 ||
          cold.contentType !== media.contentType) throw new Error('Cold object verification failed')
        const switched = await this.client.$transaction(async (tx) => {
          await tx.mediaAsset.updateMany({
            where: { id: media.id, coldKey: null }, data: { coldKey }
          })
          const current = await tx.mediaAsset.findUniqueOrThrow({ where: { id: media.id } })
          if (current.coldKey !== coldKey) throw new Error('Cold key conflict')
          const result = await tx.orderMediaSnapshot.updateMany({
            where: { ...key, storageTier: 'hot', archiveClaimToken: token },
            data: {
              storageTier: 'cold', archivedAt: now,
              archiveClaimToken: null, archiveClaimedUntil: null
            }
          })
          return result.count === 1
        })
        if (switched) archived++
      } catch (error) {
        failed++
        this.onFailure?.(key, error)
        await this.client.orderMediaSnapshot.updateMany({
          where: { ...key, archiveClaimToken: token },
          data: { archiveClaimToken: null, archiveClaimedUntil: null }
        })
      }
    }
    return { archived, failed }
  }
}
