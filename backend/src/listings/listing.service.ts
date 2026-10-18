import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'
import { DomainError } from '../common/domain-error.js'
import { paginationPolicy } from '../common/pagination-policy.js'
import { idInput, objectInput, positiveInteger, textInput } from '../common/input.js'
import { transact } from '../database/transaction.js'
import { currencyCodes, currencyInput, priceInput } from '../pricing/currencies.js'
import { RatesService } from '../pricing/rates.service.js'
import { ListingCommands } from './listing-commands.js'
import { categoryInput } from './categories.js'
import { favoritesMaxIds } from './favorites-policy.js'
import { listingTextPolicy } from './listing-policy.js'
import { mediaMaxItems } from '../media/media-policy.js'
import { lockMediaAssets } from '../media/lock-media-assets.js'

const include = {
  listingSeller: { select: { id: true, displayName: true } },
  inventoryListingRows: { select: { availability: true } },
  digitalInventoryRows: { select: { availability: true } },
  mediaRows: { select: { mediaId: true, position: true }, orderBy: { position: 'asc' } },
  _count: { select: { orderListingRows: true } }
} satisfies Prisma.ListingInclude
type ListingRow = Prisma.ListingGetPayload<{ include: typeof include }>
const homeFeaturedLimit = 10
const homeTypeLimit = 5

export class ListingService {
  constructor(
    private readonly client: PrismaClient,
    private readonly rates: RatesService
  ) {}

  private view(listing: ListingRow, priceUsd: string | null = null) {
    return {
      id: listing.id,
      seller: listing.listingSeller,
      type: listing.type,
      saleMode: listing.saleMode,
      canEdit: listing.saleMode !== 'one_off' || listing._count.orderListingRows === 0,
      title: listing.title,
      description: listing.description,
      category: listing.category,
      price: { amount: listing.priceAmount.toFixed(), currency: listing.currency },
      priceUsd,
      publicationStatus: listing.publicationStatus,
      availability:
        listing.type === 'digital'
          ? (listing.digitalInventoryRows[0]?.availability ?? 'unlimited')
          : (listing.inventoryListingRows[0]?.availability ?? 'unavailable'),
      version: listing.version,
      licenseDescription: listing.licenseDescription,
      contentVersion: listing.contentVersion,
      media: listing.mediaRows.map((entry) => ({
        id: entry.mediaId,
        position: entry.position,
        url: `/api/listings/${listing.id}/media/${entry.mediaId}`
      })),
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt
    }
  }

  async detail(id: string) {
    const listing = await this.client.listing.findFirst({
      where: { id: idInput(id), publicationStatus: 'published', currency: { in: currencyCodes } },
      include
    })
    if (!listing) throw new DomainError('NOT_FOUND')
    return this.view(listing)
  }

  async home() {
    // Each branch is bounded and can use an index; a single request supplies all home sections.
    const rows = await this.client.$queryRaw<{ section: string; id: string }[]>`
      SELECT 'featured' AS section, id, "createdAt" FROM (
        SELECT l.id, l."createdAt" FROM "Listing" l
        WHERE l."publicationStatus" = 'published' AND l."currency" IN (${Prisma.join(currencyCodes)})
        ORDER BY l."createdAt" DESC, l.id DESC LIMIT ${homeFeaturedLimit}
      ) featured
      UNION ALL
      SELECT 'digital' AS section, id, "createdAt" FROM (
        SELECT l.id, l."createdAt" FROM "Listing" l
        WHERE l."publicationStatus" = 'published' AND l."type" = 'digital'
          AND l."currency" IN (${Prisma.join(currencyCodes)})
        ORDER BY l."createdAt" DESC, l.id DESC LIMIT ${homeTypeLimit}
      ) digital
      UNION ALL
      SELECT 'physical' AS section, id, "createdAt" FROM (
        SELECT l.id, l."createdAt" FROM "Listing" l
        WHERE l."publicationStatus" = 'published' AND l."type" = 'physical'
          AND l."currency" IN (${Prisma.join(currencyCodes)})
        ORDER BY l."createdAt" DESC, l.id DESC LIMIT ${homeTypeLimit}
      ) physical
      ORDER BY section, "createdAt" DESC, id DESC`
    const listings = await this.client.listing.findMany({
      where: {
        id: { in: [...new Set(rows.map((row) => row.id))] },
        publicationStatus: 'published',
        currency: { in: currencyCodes }
      },
      include
    })
    const byId = new Map(listings.map((listing) => [listing.id, listing]))
    const section = (name: string) => rows
      .filter((row) => row.section === name)
      .flatMap((row) => {
        const listing = byId.get(row.id)
        return listing ? [this.view(listing)] : []
      })
    return { featured: section('featured'), digital: section('digital'), physical: section('physical') }
  }

  async resolveFavorites(body: unknown) {
    const input = objectInput(body, ['ids'])
    if (!Array.isArray(input.ids) || input.ids.length > favoritesMaxIds ||
      input.ids.some((id) => typeof id !== 'string'))
      throw new DomainError('INVALID_INPUT')
    const ids = [...new Set(input.ids.map((id) => idInput(id)))]
    const listings = await this.client.listing.findMany({
      where: { id: { in: ids }, publicationStatus: 'published', currency: { in: currencyCodes } },
      include
    })
    const byId = new Map(listings.map((listing) => [listing.id, listing]))
    const items = ids.flatMap((id) => {
      const listing = byId.get(id)
      return listing ? [this.view(listing)] : []
    })
    return { items, total: items.length }
  }

  async create(actorId: string, body: unknown) {
    const input = objectInput(
      body,
      ['type', 'saleMode', 'title', 'description', 'category', 'price', 'licenseDescription', 'contentVersion', 'supplyMode', 'mediaIds'],
      ['type', 'saleMode', 'title', 'description', 'category', 'price', 'mediaIds']
    )
    if (input.type !== 'physical' && input.type !== 'digital')
      throw new DomainError('INVALID_INPUT')
    const type = input.type as 'physical' | 'digital'
    const supplyMode = input.supplyMode ?? 'unlimited'
    if (input.saleMode !== 'one_off' && input.saleMode !== 'repeatable')
      throw new DomainError('INVALID_INPUT')
    if (type === 'physical' && 'supplyMode' in input) throw new DomainError('INVALID_INPUT')
    if (type === 'digital' && supplyMode !== 'single' && supplyMode !== 'unlimited')
      throw new DomainError('INVALID_INPUT')
    if (type === 'physical' && input.saleMode !== 'one_off')
      throw new DomainError('INVALID_INPUT')
    if (type === 'digital' &&
      ((supplyMode === 'single') !== (input.saleMode === 'one_off')))
      throw new DomainError('INVALID_INPUT')
    if (!Array.isArray(input.mediaIds) || input.mediaIds.length < 1 ||
      input.mediaIds.length > mediaMaxItems ||
      input.mediaIds.some((id) => typeof id !== 'string'))
      throw new DomainError('INVALID_INPUT')
    const mediaIds = input.mediaIds.map((id) => idInput(id))
    if (new Set(mediaIds).size !== mediaIds.length) throw new DomainError('INVALID_INPUT')
    const price = objectInput(input.price, ['amount', 'currency'])
    const currency = currencyInput(price.currency)
    const data = {
      sellerId: actorId,
      type,
      saleMode: input.saleMode as 'one_off' | 'repeatable',
      title: textInput(input.title, listingTextPolicy.titleMaxLength),
      description: textInput(input.description, listingTextPolicy.descriptionMaxLength),
      category: categoryInput(input.category, type),
      priceAmount: priceInput(price.amount, currency),
      currency,
      licenseDescription: type === 'digital' ? textInput(input.licenseDescription, listingTextPolicy.licenseDescriptionMaxLength) : null,
      contentVersion: type === 'digital' ? textInput(input.contentVersion, listingTextPolicy.contentVersionMaxLength) : null
    }
    if (type === 'physical' && ('licenseDescription' in input || 'contentVersion' in input))
      throw new DomainError('INVALID_INPUT')
    const id = await transact(this.client, async (tx) => {
      await requireActiveAccount(tx, actorId)
      await lockMediaAssets(tx, mediaIds)
      const assets = await tx.mediaAsset.findMany({ where: { id: { in: mediaIds } } })
      if (assets.some((asset) => asset.sellerId !== actorId)) throw new DomainError('FORBIDDEN')
      if (assets.length !== mediaIds.length || assets.some((asset) => asset.status !== 'ready'))
        throw new DomainError('INVALID_INPUT')
      if (await tx.listingMedia.count({ where: { mediaId: { in: mediaIds } } }))
        throw new DomainError('LISTING_CONFLICT')
      const listing = await tx.listing.create({ data })
      await tx.listingMedia.createMany({
        data: mediaIds.map((mediaId, position) => ({ listingId: listing.id, mediaId, position }))
      })
      if (type === 'physical')
        await tx.physicalInventory.create({ data: { listingId: listing.id } })
      if (type === 'digital' && supplyMode === 'single')
        await tx.digitalInventory.create({ data: { listingId: listing.id } })
      return listing.id
    })
    const listing = await this.client.listing.findUniqueOrThrow({ where: { id }, include })
    return this.view(listing)
  }

  async edit(actorId: string, id: string, body: unknown) {
    idInput(id)
    const input = objectInput(
      body,
      ['version', 'title', 'description', 'category', 'priceAmount',
        'licenseDescription', 'contentVersion', 'mediaIds', 'publicationStatus'],
      ['version']
    )
    const version = positiveInteger(input.version)
    if (Object.keys(input).length < 2) throw new DomainError('INVALID_INPUT')
    const listing = await this.client.listing.findUnique({ where: { id } })
    if (!listing) throw new DomainError('NOT_FOUND')
    if (listing.sellerId !== actorId) throw new DomainError('FORBIDDEN')
    const patch: {
      title?: string
      description?: string
      category?: string
      priceAmount?: string
      licenseDescription?: string
      contentVersion?: string
      mediaIds?: string[]
      publicationStatus?: 'published' | 'withdrawn'
    } = {}
    if ('title' in input) patch.title = textInput(input.title, listingTextPolicy.titleMaxLength)
    if ('description' in input)
      patch.description = textInput(input.description, listingTextPolicy.descriptionMaxLength)
    if ('category' in input) patch.category = categoryInput(input.category, listing.type as 'physical' | 'digital')
    if ('priceAmount' in input)
      patch.priceAmount = priceInput(input.priceAmount, currencyInput(listing.currency)).toFixed()
    if ('licenseDescription' in input || 'contentVersion' in input) {
      if (listing.type !== 'digital') throw new DomainError('INVALID_INPUT')
      if ('licenseDescription' in input)
        patch.licenseDescription = textInput(input.licenseDescription,
          listingTextPolicy.licenseDescriptionMaxLength)
      if ('contentVersion' in input)
        patch.contentVersion = textInput(input.contentVersion,
          listingTextPolicy.contentVersionMaxLength)
    }
    if ('mediaIds' in input) {
      if (!Array.isArray(input.mediaIds) || input.mediaIds.length < 1 ||
        input.mediaIds.length > mediaMaxItems ||
        input.mediaIds.some((mediaId) => typeof mediaId !== 'string'))
        throw new DomainError('INVALID_INPUT')
      patch.mediaIds = input.mediaIds.map((mediaId) => idInput(mediaId))
      if (new Set(patch.mediaIds).size !== patch.mediaIds.length)
        throw new DomainError('INVALID_INPUT')
    }
    if ('publicationStatus' in input) {
      if (input.publicationStatus !== 'published' && input.publicationStatus !== 'withdrawn')
        throw new DomainError('INVALID_INPUT')
      patch.publicationStatus = input.publicationStatus
    }
    await new ListingCommands(this.client).edit(actorId, id, version, patch)
    return this.view(await this.client.listing.findUniqueOrThrow({ where: { id }, include }))
  }

  async list(query: unknown, actorId?: string) {
    const keys = [
      'page',
      'limit',
      'type',
      'category',
      'currency',
      'keyword',
      'sort',
      'quoteId',
      ...(actorId ? [] : ['sellerId']),
      ...(actorId ? ['publicationStatus'] : [])
    ]
    const input = objectInput(query, keys, [])
    const pageNumber = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback
      if (typeof value !== 'string' || !/^[1-9][0-9]{0,4}$/.test(value))
        throw new DomainError('INVALID_INPUT')
      return positiveInteger(Number(value), max)
    }
    const page = pageNumber(input.page, paginationPolicy.firstPage, paginationPolicy.maxPage),
      limit = pageNumber(input.limit, paginationPolicy.defaultLimit, paginationPolicy.maxLimit)
    const sort = input.sort ?? 'newest'
    if (typeof sort !== 'string' || !['newest', 'price_asc', 'price_desc'].includes(sort))
      throw new DomainError('INVALID_INPUT')
    const clauses: Prisma.Sql[] = [Prisma.sql`l."currency" IN (${Prisma.join(currencyCodes)})`]
    if (actorId) clauses.push(Prisma.sql`l."sellerId" = ${actorId}::uuid`)
    else clauses.push(Prisma.sql`l."publicationStatus" = 'published'`)
    if (input.sellerId !== undefined)
      clauses.push(Prisma.sql`l."sellerId" = ${idInput(input.sellerId)}::uuid`)
    if (input.publicationStatus !== undefined) {
      if (input.publicationStatus !== 'published' && input.publicationStatus !== 'withdrawn')
        throw new DomainError('INVALID_INPUT')
      clauses.push(Prisma.sql`l."publicationStatus" = ${input.publicationStatus}`)
    }
    if (input.type !== undefined) {
      if (input.type !== 'physical' && input.type !== 'digital')
        throw new DomainError('INVALID_INPUT')
      clauses.push(Prisma.sql`l."type" = ${input.type}`)
    }
    if (input.category !== undefined)
      clauses.push(Prisma.sql`l."category" = ${textInput(input.category, 50)}`)
    if (input.currency !== undefined)
      clauses.push(Prisma.sql`l."currency" = ${currencyInput(input.currency)}`)
    if (input.keyword !== undefined) {
      const keyword = textInput(input.keyword, listingTextPolicy.keywordMaxLength)
      clauses.push(
        Prisma.sql`(l."title" ILIKE ${`%${keyword}%`} OR l."description" ILIKE ${`%${keyword}%`})`
      )
    }
    if (
      (sort === 'newest' && input.quoteId !== undefined) ||
      (sort !== 'newest' && page > 1 && input.quoteId === undefined)
    )
      throw new DomainError('INVALID_INPUT')
    const quote =
      sort === 'newest'
        ? null
        : await this.rates.quote(input.quoteId === undefined ? undefined : idInput(input.quoteId))
    const factor = quote
      ? Prisma.sql`((${JSON.stringify(quote.rates)}::jsonb ->> l."currency")::numeric)`
      : Prisma.sql`NULL::numeric`
    const price = Prisma.sql`(l."priceAmount" * ${factor})`
    const order =
      sort === 'newest'
        ? Prisma.sql`l."createdAt" DESC, l.id DESC`
        : sort === 'price_asc'
          ? Prisma.sql`${price} ASC, l.id ASC`
          : Prisma.sql`${price} DESC, l.id DESC`
    type JsonItem = Omit<ReturnType<typeof this.view>, 'createdAt' | 'updatedAt'> & {
      createdAt: string
      updatedAt: string
    }
    // One statement keeps page, count and joined data on one MVCC snapshot.
    // NOT MATERIALIZED lets the page use its ordering index instead of copying
    // the complete catalog. Money stays numeric in SQL and text in JSON.
    const [result] = await this.client.$queryRaw<{ total: bigint; items: JsonItem[] }[]>`
      WITH filtered AS NOT MATERIALIZED (
        SELECT l.* FROM "Listing" l WHERE ${Prisma.join(clauses, ' AND ')}
      ), selected AS (
        SELECT l.*, (${price})::text AS usd FROM filtered l
        ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}
      )
      SELECT (SELECT count(*)::bigint FROM filtered) AS total,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', l.id,
          'seller', jsonb_build_object('id', a.id, 'displayName', a."displayName"),
          'type', l.type, 'saleMode', l."saleMode",
          'canEdit', l."saleMode" <> 'one_off' OR NOT EXISTS (
            SELECT 1 FROM "Order" o WHERE o."listingId" = l.id
          ),
          'title', l.title, 'description', l.description,
          'category', l.category,
          'price', jsonb_build_object('amount', l."priceAmount"::text, 'currency', l.currency),
          'priceUsd', l.usd, 'publicationStatus', l."publicationStatus",
          'availability', CASE WHEN l.type = 'digital' THEN coalesce(di.availability, 'unlimited')
            ELSE coalesce(pi.availability, 'unavailable') END,
          'version', l.version, 'licenseDescription', l."licenseDescription",
          'contentVersion', l."contentVersion",
          'media', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', lm."mediaId", 'position', lm.position,
            'url', '/api/listings/' || l.id::text || '/media/' || lm."mediaId"::text
          ) ORDER BY lm.position) FROM "ListingMedia" lm WHERE lm."listingId" = l.id), '[]'::jsonb),
          'createdAt', l."createdAt", 'updatedAt', l."updatedAt"
        ) ORDER BY ${order}) FROM selected l
          JOIN "Account" a ON a.id = l."sellerId"
          LEFT JOIN "PhysicalInventory" pi ON pi."listingId" = l.id
          LEFT JOIN "DigitalInventory" di ON di."listingId" = l.id), '[]'::jsonb) AS items`
    return {
      items: result.items.slice(0, limit).map(item => ({
        ...item,
        price: { ...item.price, amount: new Prisma.Decimal(item.price.amount).toFixed() },
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt)
      })),
      page,
      limit,
      total: Number(result.total),
      hasMore: result.items.length > limit,
      quote: quote ? this.rates.view(quote) : null
    }
  }
}
