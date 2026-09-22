import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req
} from '@nestjs/common'
import { type AuthRequest } from '../auth/auth.guard.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput, positiveInteger, textInput } from '../common/input.js'
import { DatabaseService } from '../database/database.service.js'
import { OrderCommands, type ActionInput, type OrderAction } from './order-commands.js'

const actions = new Map<string, OrderAction>([
  ['cancel', 'cancel'],
  ['pay', 'pay'],
  ['deliver', 'deliver'],
  ['issue', 'issue'],
  ['request-refund', 'request_refund'],
  ['counteroffer', 'counteroffer'],
  ['accept', 'accept'],
  ['refund', 'refund'],
  ['restore', 'restore']
])

function idempotencyKey(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new DomainError('INVALID_INPUT')
  return value
}

function queryInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))
    throw new DomainError('INVALID_INPUT')
  return positiveInteger(Number(value), max)
}

function createOrderInput(body: unknown) {
  const input = objectInput(body, ['listingId', 'version', 'shipping'], ['listingId', 'version'])
  const shipping = input.shipping === undefined
    ? undefined
    : objectInput(input.shipping, ['recipient', 'contact', 'address'],
      ['recipient', 'contact', 'address'])
  return {
    listingId: idInput(input.listingId),
    version: positiveInteger(input.version),
    shipping: shipping ? {
      recipient: textInput(shipping.recipient, 100),
      contact: textInput(shipping.contact, 100),
      address: textInput(shipping.address, 500)
    } : undefined
  }
}

@Controller()
export class OrderController {
  private readonly commands: OrderCommands
  private readonly client: DatabaseService['client']

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.commands = new OrderCommands(database.client)
    this.client = database.client
  }

  private async participantOrder(id: string, accountId: string) {
    const order = await this.client.order.findFirst({
      where: { id, OR: [{ buyerId: accountId }, { sellerId: accountId }] },
      include: { snapshot: true, shipping: true }
    })
    if (!order) throw new DomainError('NOT_FOUND')
    return order
  }

  private page(query: Record<string, unknown>) {
    const input = objectInput(query, ['page', 'limit'], [])
    return {
      page: queryInteger(input.page, 1, 1000),
      limit: queryInteger(input.limit, 20, 50)
    }
  }

  @Post('orders')
  @HttpCode(200)
  async create(
    @Req() request: AuthRequest,
    @Headers('idempotency-key') header: string | string[] | undefined,
    @Body() body: unknown
  ) {
    const key = idempotencyKey(header)
    return {
      orderId: await this.commands.create(request.auth.account.id, key, createOrderInput(body))
    }
  }

  @Post('checkouts')
  @HttpCode(200)
  async checkout(
    @Req() request: AuthRequest,
    @Headers('idempotency-key') header: string | string[] | undefined,
    @Body() body: unknown
  ) {
    const key = idempotencyKey(header)
    const input = objectInput(body, ['items'], ['items'])
    if (!Array.isArray(input.items) || input.items.length < 2 || input.items.length > 5)
      throw new DomainError('INVALID_INPUT')
    const items = input.items.map(createOrderInput)
    return this.commands.createCheckout(request.auth.account.id, key, items)
  }

  @Post('checkouts/:id')
  @HttpCode(200)
  async checkoutDetail(@Req() request: AuthRequest, @Param('id') rawId: string) {
    const checkout = await this.client.checkout.findFirst({
      where: { id: idInput(rawId), buyerId: request.auth.account.id },
      include: { orders: { include: { snapshot: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
    })
    if (!checkout) throw new DomainError('NOT_FOUND')
    return {
      id: checkout.id,
      createdAt: checkout.createdAt,
      items: checkout.orders.map((order) => ({
        orderId: order.id,
        listingId: order.listingId,
        sellerId: order.sellerId,
        status: order.status,
        title: order.snapshot?.title,
        price: order.snapshot && {
          amount: order.snapshot.priceAmount.toFixed(), currency: order.snapshot.currency
        }
      }))
    }
  }

  @Post('orders/search')
  @HttpCode(200)
  async list(@Req() request: AuthRequest, @Query() query: Record<string, unknown>) {
    const input = objectInput(query, ['role', 'status', 'page', 'limit'], [])
    const page = queryInteger(input.page, 1, 1000)
    const limit = queryInteger(input.limit, 20, 50)
    if (input.role !== undefined && input.role !== 'buyer' && input.role !== 'seller')
      throw new DomainError('INVALID_INPUT')
    if (
      input.status !== undefined &&
      (typeof input.status !== 'string' ||
        ![
          'pending_payment',
          'pending_delivery',
          'pending_acceptance',
          'issue',
          'completed',
          'cancelled',
          'expired',
          'refunded'
        ].includes(input.status))
    )
      throw new DomainError('INVALID_INPUT')
    const accountId = request.auth.account.id
    const where = {
      ...(input.role === 'seller' || input.role === undefined ? {} : { buyerId: accountId }),
      ...(input.role === 'seller' ? { sellerId: accountId } : {}),
      ...(input.role === undefined
        ? { OR: [{ buyerId: accountId }, { sellerId: accountId }] }
        : {}),
      ...(input.status === undefined ? {} : { status: input.status })
    }
    const rows = await this.client.order.findMany({
      where,
      include: { snapshot: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit + 1
    })
    return {
      items: rows.slice(0, limit).map((order) => ({
        id: order.id,
        listingId: order.listingId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        checkoutId: order.checkoutId,
        status: order.status,
        version: order.version,
        title: order.snapshot?.title,
        type: order.snapshot?.type,
        price: order.snapshot && {
          amount: order.snapshot.priceAmount.toFixed(),
          currency: order.snapshot.currency
        },
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      })),
      page,
      limit,
      hasMore: rows.length > limit
    }
  }

  @Post('orders/:id')
  @HttpCode(200)
  async detail(@Req() request: AuthRequest, @Param('id') id: string) {
    const order = await this.participantOrder(idInput(id), request.auth.account.id)
    const review = await this.client.sellerReview.findUnique({ where: { orderId: order.id } })
    return {
      id: order.id,
      listingId: order.listingId,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      checkoutId: order.checkoutId,
      status: order.status,
      version: order.version,
      review: review ? { rating: review.rating, createdAt: review.createdAt } : null,
      title: order.snapshot?.title,
      type: order.snapshot?.type,
      price: order.snapshot && {
        amount: order.snapshot.priceAmount.toFixed(),
        currency: order.snapshot.currency
      },
      snapshot: order.snapshot && {
        listingVersion: order.snapshot.listingVersion,
        title: order.snapshot.title,
        description: order.snapshot.description,
        type: order.snapshot.type,
        category: order.snapshot.category,
        price: { amount: order.snapshot.priceAmount.toFixed(), currency: order.snapshot.currency },
        licenseDescription: order.snapshot.licenseDescription,
        contentVersion: order.snapshot.contentVersion
      },
      shipping: order.shipping && {
        recipient: order.shipping.recipient,
        contact: order.shipping.contact,
        address: order.shipping.address
      },
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    }
  }

  @Post('orders/:id/deliveries')
  @HttpCode(200)
  async deliveries(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>
  ) {
    const order = await this.participantOrder(idInput(id), request.auth.account.id)
    const { page, limit } = this.page(query)
    const rows = await this.client.deliveryRecord.findMany({
      where: { orderId: order.id },
      orderBy: [{ sequence: 'asc' }],
      skip: (page - 1) * limit,
      take: limit + 1
    })
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        sequence: row.sequence,
        orderId: row.orderId,
        sellerId: row.sellerId,
        carrier: row.carrier,
        accessCode: row.accessCode,
        kind: row.kind,
        reference: row.reference,
        createdAt: row.createdAt
      })),
      page,
      limit,
      hasMore: rows.length > limit
    }
  }

  @Post('orders/:id/issues')
  @HttpCode(200)
  async issues(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>
  ) {
    const order = await this.participantOrder(idInput(id), request.auth.account.id)
    const { page, limit } = this.page(query)
    const rows = await this.client.issueRecord.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit + 1
    })
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        sourceStatus: row.sourceStatus,
        orderId: row.orderId,
        buyerId: row.buyerId,
        description: row.description,
        status: row.status,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt
      })),
      page,
      limit,
      hasMore: rows.length > limit
    }
  }

  @Post('orders/:id/refunds')
  @HttpCode(200)
  async refunds(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>
  ) {
    const order = await this.participantOrder(idInput(id), request.auth.account.id)
    const { page, limit } = this.page(query)
    const rows = await this.client.refundRequest.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit + 1
    })
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        issueId: row.issueId,
        orderId: row.orderId,
        approvedBy: row.approvedBy,
        resolvedBy: row.resolvedBy,
        requestedBy: row.requestedBy,
        status: row.status,
        returnOutcome: row.returnOutcome,
        createdAt: row.createdAt,
        approvedAt: row.approvedAt
      })),
      page,
      limit,
      hasMore: rows.length > limit
    }
  }

  @Post('orders/:id/settlements')
  @HttpCode(200)
  async settlements(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>
  ) {
    const order = await this.participantOrder(idInput(id), request.auth.account.id)
    const { page, limit } = this.page(query)
    const rows = await this.client.settlementRecord.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit + 1
    })
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        mode: row.mode,
        orderId: row.orderId,
        operation: row.operation,
        price: { amount: row.amount.toFixed(), currency: row.currency },
        createdAt: row.createdAt
      })),
      page,
      limit,
      hasMore: rows.length > limit
    }
  }

  @Post('orders/:id/events')
  @HttpCode(200)
  async events(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>
  ) {
    const order = await this.participantOrder(idInput(id), request.auth.account.id)
    const { page, limit } = this.page(query)
    const rows = await this.client.orderEvent.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit + 1
    })
    return {
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        actorId: row.actorId,
        orderId: row.orderId,
        operation: row.operation,
        note: row.note,
        fromState: row.fromState,
        toState: row.toState,
        createdAt: row.createdAt
      })),
      page,
      limit,
      hasMore: rows.length > limit
    }
  }

  @Post('orders/:id/actions/:action')
  @HttpCode(200)
  async action(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Headers('idempotency-key') header: string | string[] | undefined,
    @Body() body: unknown
  ) {
    const key = idempotencyKey(header)
    const order = await this.participantOrder(idInput(id), request.auth.account.id)
    const operation = actions.get(action)
    if (!operation) throw new DomainError('INVALID_INPUT')
    const sellerAction = ['deliver', 'counteroffer', 'refund', 'restore'].includes(operation)
    if (request.auth.account.id !== (sellerAction ? order.sellerId : order.buyerId))
      throw new DomainError('FORBIDDEN')
    const physical = order.snapshot?.type === 'physical'
    const actionInput: ActionInput = {}
    switch (operation) {
      case 'deliver': {
        if (physical) {
          const input = objectInput(body, ['carrier', 'trackingNumber'])
          actionInput.carrier = textInput(input.carrier, 100)
          actionInput.reference = textInput(input.trackingNumber, 200)
        } else {
          const input = objectInput(body, ['url', 'accessCode'], ['url'])
          const reference = textInput(input.url, 2048)
          let url: URL
          try {
            url = new URL(reference)
          } catch {
            throw new DomainError('INVALID_INPUT')
          }
          if (url.protocol !== 'https:' || url.username || url.password)
            throw new DomainError('INVALID_INPUT')
          actionInput.reference = reference
          if (input.accessCode !== undefined)
            actionInput.accessCode = textInput(input.accessCode, 100)
        }
        break
      }
      case 'issue':
        actionInput.description = textInput(objectInput(body, ['description']).description, 2000)
        break
      case 'counteroffer':
        actionInput.description = textInput(objectInput(body, ['description']).description, 2000)
        break
      case 'accept':
        if (objectInput(body, ['confirmed']).confirmed !== true)
          throw new DomainError('INVALID_INPUT')
        break
      case 'restore':
        if (objectInput(body, ['inHandAndResellable']).inHandAndResellable !== true)
          throw new DomainError('INVALID_INPUT')
        actionInput.inHandAndResellable = true
        break
      case 'refund':
        if (physical) {
          const value = objectInput(body, ['returnOutcome']).returnOutcome
          if (
            typeof value !== 'string' ||
            !['not_sent', 'returned', 'not_required'].includes(value)
          )
            throw new DomainError('INVALID_INPUT')
          actionInput.returnOutcome = value
        } else objectInput(body, [], [])
        break
      default:
        objectInput(body, [], [])
    }
    return {
      orderId: await this.commands.act(
        request.auth.account.id,
        key,
        idInput(id),
        operation,
        actionInput
      )
    }
  }
}
