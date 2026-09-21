import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput, positiveInteger, textInput } from '../common/input.js'
import { transact } from '../database/transaction.js'
import { currencyCodes, currencyInput, priceInput } from '../pricing/currencies.js'
import { RatesService } from '../pricing/rates.service.js'
import { ListingCommands } from './listing-commands.js'

const include = {
  listingSeller: { select: { id: true, displayName: true } },
  inventoryListingRows: { select: { availability: true } },
  digitalInventoryRows: { select: { availability: true } }
} satisfies Prisma.ListingInclude
type ListingRow = Prisma.ListingGetPayload<{ include: typeof include }>

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

  async resolveFavorites(body: unknown) {
    const input = objectInput(body, ['ids'])
    if (!Array.isArray(input.ids) || input.ids.length > 100 ||
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
      ['type', 'title', 'description', 'category', 'price', 'licenseDescription', 'contentVersion', 'supplyMode'],
      ['type', 'title', 'description', 'category', 'price']
    )
    if (input.type !== 'physical' && input.type !== 'digital')
      throw new DomainError('INVALID_INPUT')
    const type = input.type as 'physical' | 'digital'
    const supplyMode = input.supplyMode ?? 'unlimited'
    if (type === 'physical' && 'supplyMode' in input) throw new DomainError('INVALID_INPUT')
    if (type === 'digital' && supplyMode !== 'single' && supplyMode !== 'unlimited')
      throw new DomainError('INVALID_INPUT')
    const price = objectInput(input.price, ['amount', 'currency'])
    const currency = currencyInput(price.currency)
    const data = {
      sellerId: actorId,
      type,
      title: textInput(input.title, 100),
      description: textInput(input.description, 5000),
      category: textInput(input.category, 50),
      priceAmount: priceInput(price.amount, currency),
      currency,
      licenseDescription: type === 'digital' ? textInput(input.licenseDescription, 2000) : null,
      contentVersion: type === 'digital' ? textInput(input.contentVersion, 100) : null
    }
    if (type === 'physical' && ('licenseDescription' in input || 'contentVersion' in input))
      throw new DomainError('INVALID_INPUT')
    const id = await transact(this.client, async (tx) => {
      await requireActiveAccount(tx, actorId)
      const listing = await tx.listing.create({ data })
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
      ['version', 'title', 'priceAmount', 'publicationStatus'],
      ['version']
    )
    const version = positiveInteger(input.version)
    if (Object.keys(input).length < 2) throw new DomainError('INVALID_INPUT')
    const listing = await this.client.listing.findUnique({ where: { id } })
    if (!listing) throw new DomainError('NOT_FOUND')
    if (listing.sellerId !== actorId) throw new DomainError('FORBIDDEN')
    const patch: {
      title?: string
      priceAmount?: string
      publicationStatus?: 'published' | 'withdrawn'
    } = {}
    if ('title' in input) patch.title = textInput(input.title, 100)
    if ('priceAmount' in input)
      patch.priceAmount = priceInput(input.priceAmount, currencyInput(listing.currency)).toFixed()
    if ('publicationStatus' in input) {
      if (input.publicationStatus !== 'published' && input.publicationStatus !== 'withdrawn')
        throw new DomainError('INVALID_INPUT')
      patch.publicationStatus = input.publicationStatus
    }
    const updated = await new ListingCommands(this.client).edit(actorId, id, version, patch)
    return this.view({
      ...updated,
      listingSeller: {
        id: actorId,
        displayName: (await this.client.account.findUniqueOrThrow({ where: { id: actorId } }))
          .displayName
      },
      inventoryListingRows: await this.client.physicalInventory.findMany({
        where: { listingId: id },
        select: { availability: true }
      }),
      digitalInventoryRows: await this.client.digitalInventory.findMany({
        where: { listingId: id },
        select: { availability: true }
      })
    })
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
      ...(actorId ? ['publicationStatus'] : [])
    ]
    const input = objectInput(query, keys, [])
    const pageNumber = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback
      if (typeof value !== 'string' || !/^[1-9][0-9]{0,4}$/.test(value))
        throw new DomainError('INVALID_INPUT')
      return positiveInteger(Number(value), max)
    }
    const page = pageNumber(input.page, 1, 1000),
      limit = pageNumber(input.limit, 20, 50)
    const sort = input.sort ?? 'newest'
    if (typeof sort !== 'string' || !['newest', 'price_asc', 'price_desc'].includes(sort))
      throw new DomainError('INVALID_INPUT')
    const clauses: Prisma.Sql[] = [Prisma.sql`l."currency" IN (${Prisma.join(currencyCodes)})`]
    if (actorId) clauses.push(Prisma.sql`l."sellerId" = ${actorId}::uuid`)
    else clauses.push(Prisma.sql`l."publicationStatus" = 'published'`)
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
      const keyword = textInput(input.keyword, 100)
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
    return this.client.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; usd: string | null }[]>`
        SELECT l.id, (${price})::text AS usd FROM "Listing" l
        WHERE ${Prisma.join(clauses, ' AND ')} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`
        const [{ total }] = await tx.$queryRaw<{ total: bigint }[]>`
          SELECT COUNT(*)::bigint AS total FROM "Listing" l
          WHERE ${Prisma.join(clauses, ' AND ')}
        `
        const selected = rows.slice(0, limit)
        const listings = await tx.listing.findMany({
          where: { id: { in: selected.map((row) => row.id) } },
          include
        })
        const byId = new Map(listings.map((listing) => [listing.id, listing]))
        return {
          items: selected.map((row) => this.view(byId.get(row.id)!, row.usd)),
          page,
          limit,
          total: Number(total),
          hasMore: rows.length > limit,
          quote: quote ? this.rates.view(quote) : null
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
  }
}
