import { createHash, randomUUID } from 'node:crypto'
import { type PrismaClient } from '../generated/prisma/client.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput, positiveInteger } from '../common/input.js'
import { GarageObjectStore } from './garage-object-store.js'
import {
  isImageContentType,
  mediaMaxBytes,
  mediaUploadUrlSeconds,
  validateImageBytes
} from './media-policy.js'

export class MediaService {
  constructor(
    private readonly client: PrismaClient,
    private readonly store: GarageObjectStore | null
  ) {}

  private requireStore() {
    if (!this.store) throw new DomainError('MEDIA_UNAVAILABLE')
    return this.store
  }

  async createIntent(actorId: string, body: unknown) {
    const store = this.requireStore()
    const input = objectInput(body, ['contentType', 'byteSize'])
    if (!isImageContentType(input.contentType)) throw new DomainError('INVALID_INPUT')
    const byteSize = positiveInteger(input.byteSize, mediaMaxBytes)
    await requireActiveAccount(this.client, actorId)
    const pending = await this.client.mediaAsset.count({
      where: { sellerId: actorId, status: 'pending' }
    })
    if (pending >= 32) throw new DomainError('MEDIA_LIMIT_REACHED')
    const id = randomUUID()
    const uploadKey = `staging/${actorId}/${id}`
    await this.client.mediaAsset.create({
      data: { id, sellerId: actorId, uploadKey, contentType: input.contentType, declaredBytes: byteSize }
    })
    let uploadUrl: string
    try {
      uploadUrl = await store.createUploadUrl(uploadKey, input.contentType, mediaUploadUrlSeconds)
    } catch {
      throw new DomainError('MEDIA_UNAVAILABLE')
    }
    return {
      assetId: id,
      uploadUrl,
      expiresIn: mediaUploadUrlSeconds
    }
  }

  async complete(actorId: string, id: string) {
    const store = this.requireStore()
    const asset = await this.client.mediaAsset.findUnique({ where: { id: idInput(id) } })
    if (!asset) throw new DomainError('NOT_FOUND')
    if (asset.sellerId !== actorId) throw new DomainError('FORBIDDEN')
    await requireActiveAccount(this.client, actorId)
    if (asset.status === 'ready') return this.view(asset)
    if (asset.status !== 'pending') throw new DomainError('INVALID_INPUT')
    if (!isImageContentType(asset.contentType)) throw new DomainError('INVALID_INPUT')
    let head
    try {
      head = await store.headHot(asset.uploadKey)
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error &&
        ['NotFound', 'NoSuchKey'].includes(String(error.name))) throw new DomainError('INVALID_INPUT')
      throw new DomainError('MEDIA_UNAVAILABLE')
    }
    if (head.contentLength !== asset.declaredBytes || head.contentType !== asset.contentType)
      throw new DomainError('INVALID_INPUT')
    const { bytes } = await this.readStored(() => store.readHot(asset.uploadKey, mediaMaxBytes + 1))
    if (bytes.length !== asset.declaredBytes || !validateImageBytes(bytes, asset.contentType))
      throw new DomainError('INVALID_INPUT')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // A unique final key prevents a still-valid staging PUT from changing an attached asset.
    const hotKey = `assets/${asset.id}/${randomUUID()}`
    await this.readStored(() => store.putHot(hotKey, bytes, asset.contentType))
    const finalHead = await this.readStored(() => store.headHot(hotKey))
    if (finalHead.contentLength !== bytes.length || finalHead.contentType !== asset.contentType)
      throw new DomainError('MEDIA_UNAVAILABLE')
    const result = await this.client.mediaAsset.updateMany({
      where: { id: asset.id, status: 'pending' },
      data: { status: 'ready', hotKey, actualBytes: bytes.length, sha256, verifiedAt: new Date() }
    })
    if (result.count === 0) {
      await store.deleteHot(hotKey)
      const current = await this.client.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })
      if (current.status !== 'ready') throw new DomainError('INVALID_INPUT')
      return this.view(current)
    }
    // Staging cleanup is best effort. Failed deletes must be reconciled operationally.
    await store.deleteHot(asset.uploadKey).catch(() => {})
    return this.view(await this.client.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }))
  }

  async readListing(listingId: string, mediaId: string) {
    const store = this.requireStore()
    const row = await this.client.listingMedia.findUnique({
      where: { listingId_mediaId: { listingId: idInput(listingId), mediaId: idInput(mediaId) } },
      include: {
        listing: { select: { publicationStatus: true, reviewStatus: true } },
        media: { select: { status: true, hotKey: true, sha256: true, contentType: true } }
      }
    })
    if (!row || row.listing.publicationStatus !== 'published' || row.listing.reviewStatus !== 'clear' ||
      row.media.status !== 'ready' || !row.media.hotKey) throw new DomainError('NOT_FOUND')
    const { bytes, contentType } = await this.readStored(() =>
      store.readHot(row.media.hotKey!, mediaMaxBytes + 1))
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== row.media.sha256 || contentType !== row.media.contentType)
      throw new DomainError('MEDIA_UNAVAILABLE')
    return { bytes, contentType }
  }

  async readOrder(orderId: string, mediaId: string, actorId: string) {
    const store = this.requireStore()
    const row = await this.client.orderMediaSnapshot.findFirst({
      where: {
        orderId: idInput(orderId), mediaId: idInput(mediaId),
        order: { OR: [{ buyerId: actorId }, { sellerId: actorId }] }
      },
      include: { media: { select: { hotKey: true, coldKey: true, sha256: true, contentType: true } } }
    })
    if (!row) throw new DomainError('NOT_FOUND')
    const key = row.storageTier === 'cold' ? row.media.coldKey : row.media.hotKey
    if (!key) throw new DomainError('MEDIA_UNAVAILABLE')
    const { bytes, contentType } = await this.readStored(() => row.storageTier === 'cold'
      ? store.readCold(key, mediaMaxBytes + 1) : store.readHot(key, mediaMaxBytes + 1))
    if (createHash('sha256').update(bytes).digest('hex') !== row.media.sha256 ||
      contentType !== row.media.contentType) throw new DomainError('MEDIA_UNAVAILABLE')
    return { bytes, contentType }
  }

  private view(asset: { id: string; status: string; sha256: string | null }) {
    return { assetId: asset.id, status: asset.status, sha256: asset.sha256 }
  }

  private async readStored<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch {
      throw new DomainError('MEDIA_UNAVAILABLE')
    }
  }
}
