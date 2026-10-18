import { createHash } from 'node:crypto'
import { type PrismaClient } from '../generated/prisma/client.js'
import { GarageObjectStore } from './garage-object-store.js'
import { mediaHotRetirementGraceHours, mediaMaxBytes, mediaPendingTtlHours } from './media-policy.js'
import { lockMediaAssets } from './lock-media-assets.js'

const hourMs = 60 * 60 * 1000

export class OrphanService {
  private readonly cursors: Record<string, string | undefined> = {}
  constructor(
    private readonly client: PrismaClient,
    private readonly store: GarageObjectStore
  ) {}

  async expirePending(now = new Date(), limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid orphan batch limit')
    const cutoff = new Date(now.getTime() - mediaPendingTtlHours * hourMs)
    const candidates = await this.client.mediaAsset.findMany({
      where: { status: { in: ['pending', 'expired'] }, createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, uploadKey: true, status: true }
    })
    let expired = 0, failed = 0
    for (const candidate of candidates) {
      const claimed = await this.client.mediaAsset.updateMany({
        where: { id: candidate.id, status: candidate.status, createdAt: { lt: cutoff } },
        data: { status: 'expired' }
      })
      if (claimed.count !== 1) continue
      if (candidate.status === 'pending') expired++
      try {
        await this.store.deleteHot(candidate.uploadKey)
        await this.client.mediaAsset.updateMany({
          where: { id: candidate.id, status: 'expired' }, data: { status: 'discarded' }
        })
      } catch {
        failed++
      }
    }
    return { expired, failed }
  }

  async reconcileUntracked(now = new Date()) {
    const cutoff = now.getTime() - mediaPendingTtlHours * hourMs
    let observed = 0, deleted = 0, failed = 0
    for (const source of [
      { tier: 'hot', prefix: 'assets/', field: 'hotKey' },
      { tier: 'hot', prefix: 'staging/', field: 'uploadKey' },
      { tier: 'cold', prefix: 'archive/', field: 'coldKey' }
    ] as const) {
      const cursorId = `${source.tier}:${source.prefix}`
      try {
        const page = source.tier === 'hot'
          ? await this.store.listHot(source.prefix, this.cursors[cursorId])
          : await this.store.listCold(source.prefix, this.cursors[cursorId])
        const candidates = page.objects.filter((item) =>
          Number.isFinite(item.lastModified.getTime()) && item.lastModified.getTime() < cutoff)
        const keys = candidates.map((item) => item.key)
        const rows = source.field === 'hotKey'
          ? await this.client.mediaAsset.findMany({
            where: { hotKey: { in: keys } }, select: { hotKey: true }
          })
          : source.field === 'coldKey'
            ? await this.client.mediaAsset.findMany({
              where: { coldKey: { in: keys } }, select: { coldKey: true }
            })
            : await this.client.mediaAsset.findMany({
              where: { uploadKey: { in: keys }, status: 'pending' },
              select: { uploadKey: true }
            })
        const referenced = new Set(rows.map((row) =>
          'hotKey' in row ? row.hotKey : 'coldKey' in row ? row.coldKey : row.uploadKey))
        for (const candidate of candidates) {
          if (referenced.has(candidate.key)) continue
          try {
            const current = source.field === 'hotKey'
              ? await this.client.mediaAsset.findUnique({ where: { hotKey: candidate.key } })
              : source.field === 'coldKey'
                ? await this.client.mediaAsset.findUnique({ where: { coldKey: candidate.key } })
                : await this.client.mediaAsset.findUnique({ where: { uploadKey: candidate.key } })
            if (current && (source.field !== 'uploadKey' || current.status === 'pending')) continue
            observed++
            if (source.tier === 'hot') await this.store.deleteHot(candidate.key)
            else await this.store.deleteCold(candidate.key)
            deleted++
          } catch {
            failed++
          }
        }
        this.cursors[cursorId] = page.nextToken
      } catch {
        this.cursors[cursorId] = undefined
        failed++
      }
    }
    return { observed, deleted, failed }
  }

  async retireUnusedHot(now = new Date(), limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid retirement batch limit')
    const cutoff = new Date(now.getTime() - mediaHotRetirementGraceHours * hourMs)
    const candidates = await this.client.mediaAsset.findMany({
      where: {
        status: 'ready', hotKey: { not: null }, coldKey: { not: null },
        listingRows: { none: {} },
        orderRows: {
          some: { storageTier: 'cold', archivedAt: { lt: cutoff } },
          none: { OR: [
            { storageTier: 'hot' }, { archivedAt: null }, { archivedAt: { gte: cutoff } }
          ] }
        }
      },
      orderBy: { createdAt: 'asc' }, take: limit,
      select: { id: true, hotKey: true, coldKey: true, actualBytes: true,
        sha256: true, contentType: true }
    })
    let retired = 0, failed = 0
    for (const candidate of candidates) {
      try {
        if (!candidate.coldKey || !candidate.hotKey || !candidate.actualBytes ||
          !candidate.sha256) continue
        const cold = await this.store.readCold(candidate.coldKey, mediaMaxBytes + 1)
        if (cold.bytes.length !== candidate.actualBytes ||
          cold.contentType !== candidate.contentType ||
          createHash('sha256').update(cold.bytes).digest('hex') !== candidate.sha256)
          throw new Error('Cold object verification failed')
        const changed = await this.client.$transaction(async (tx) => {
          await lockMediaAssets(tx, [candidate.id])
          const current = await tx.mediaAsset.findUniqueOrThrow({ where: { id: candidate.id },
            include: { listingRows: { select: { listingId: true } },
              orderRows: { select: { storageTier: true, archivedAt: true } } } })
          if (current.status !== 'ready' || current.hotKey !== candidate.hotKey ||
            current.coldKey !== candidate.coldKey || current.listingRows.length > 0 ||
            current.orderRows.length === 0 ||
            current.orderRows.some((row) => row.storageTier !== 'cold' ||
              !row.archivedAt || row.archivedAt >= cutoff)) return false
          await tx.mediaAsset.update({ where: { id: candidate.id },
            data: { status: 'cold_only', hotKey: null } })
          return true
        })
        if (!changed) continue
        await this.store.deleteHot(candidate.hotKey)
        retired++
      } catch {
        failed++
      }
    }
    return { retired, failed }
  }
}
