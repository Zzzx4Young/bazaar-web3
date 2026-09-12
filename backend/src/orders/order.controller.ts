import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common'
import { type AuthRequest } from '../auth/auth.guard.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput, positiveInteger, textInput } from '../common/input.js'
import { DatabaseService } from '../database/database.service.js'
import { OrderCommands, type ActionInput, type OrderAction } from './order-commands.js'

const actionNames = new Set<OrderAction>([
  'cancel',
  'pay',
  'deliver',
  'issue',
  'request_refund',
  'accept',
  'refund',
  'restore'
])

function idempotencyKey(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new DomainError('INVALID_INPUT')
  return value
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
      page: input.page === undefined ? 1 : positiveInteger(input.page, 1000),
      limit: input.limit === undefined ? 20 : positiveInteger(input.limit, 50)
    }
  }

  @Post('orders')
  async create(
    @Req() request: AuthRequest,
    @Headers('idempotency-key') header: string | string[] | undefined,
    @Body() body: unknown
  ) {
    const key = idempotencyKey(header)
    const input = objectInput(body, ['listingId', 'version', 'shipping'], ['listingId', 'version'])
    const shipping = input.shipping === undefined ? undefined : objectInput(
      input.shipping,
      ['recipient', 'contact', 'address'],
      ['recipient', 'contact', 'address']
    )
    return {
      orderId: await this.commands.create(request.auth.account.id, key, {
        listingId: idInput(input.listingId),
        version: positiveInteger(input.version),
        shipping: shipping
          ? {
              recipient: textInput(shipping.recipient, 100),
              contact: textInput(shipping.contact, 100),
              address: textInput(shipping.address, 500)
            }
          : undefined
      })
    }
  }

  @Post('orders/search')
  @HttpCode(200)
  async list(@Req() request: AuthRequest, @Query() query: Record<string, unknown>) {
    const input = objectInput(query, ['role', 'status', 'page', 'limit'], [])
    const page = input.page === undefined ? 1 : positiveInteger(input.page, 1000)
    const limit = input.limit === undefined ? 20 : positiveInteger(input.limit, 50)
    if (input.role !== undefined && input.role !== 'buyer' && input.role !== 'seller')
      throw new DomainError('INVALID_INPUT')
    if (input.status !== undefined && typeof input.status !== 'string')
      throw new DomainError('INVALID_INPUT')
    const accountId = request.auth.account.id
    const where = {
      ...(input.role === 'seller' || input.role === undefined ? {} : { buyerId: accountId }),
      ...(input.role === 'seller' ? { sellerId: accountId } : {}),
      ...(input.role === undefined ? { OR: [{ buyerId: accountId }, { sellerId: accountId }] } : {}),
      ...(input.status === undefined ? {} : { status: input.status })
    }
    const rows = await this.commands.client.order.findMany({
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
        status: order.status,
        version: order.version,
        snapshot: order.snapshot && {
          title: order.snapshot.title,
          description: order.snapshot.description,
          type: order.snapshot.type,
          category: order.snapshot.category,
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
    return {
      id: order.id,
      listingId: order.listingId,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      status: order.status,
      version: order.version,
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
        amount: order.snapshot.priceAmount.toFixed(),
        currency: order.snapshot.currency,
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
  async deliveries(@Req() request: AuthRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
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
  async issues(@Req() request: AuthRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
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
  async refunds(@Req() request: AuthRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
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
  async settlements(@Req() request: AuthRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
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
        operation: row.operation,
        amount: row.amount.toFixed(),
        currency: row.currency,
        createdAt: row.createdAt
      })),
      page,
      limit,
      hasMore: rows.length > limit
    }
  }

  @Post('orders/:id/events')
  @HttpCode(200)
  async events(@Req() request: AuthRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
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
        operation: row.operation,
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
    if (!actionNames.has(action as OrderAction)) throw new DomainError('INVALID_INPUT')
    const input = objectInput(
      body,
      ['reference', 'description', 'returnOutcome', 'inHandAndResellable'],
      []
    ) as Record<string, unknown>
    const actionInput: ActionInput = {}
    if (input.reference !== undefined) actionInput.reference = textInput(input.reference, 2048)
    if (input.description !== undefined) actionInput.description = textInput(input.description, 2000)
    if (input.returnOutcome !== undefined) actionInput.returnOutcome = textInput(input.returnOutcome, 32)
    if (input.inHandAndResellable !== undefined) {
      if (typeof input.inHandAndResellable !== 'boolean') throw new DomainError('INVALID_INPUT')
      actionInput.inHandAndResellable = input.inHandAndResellable
    }
    return {
      orderId: await this.commands.act(
        request.auth.account.id,
        key,
        idInput(id),
        action as OrderAction,
        actionInput
      )
    }
  }
}
