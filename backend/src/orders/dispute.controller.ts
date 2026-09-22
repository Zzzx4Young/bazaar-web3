import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common'
import { type AuthRequest } from '../auth/auth.guard.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput } from '../common/input.js'
import { DatabaseService } from '../database/database.service.js'
import { OrderCommands } from './order-commands.js'

@Controller('admin/disputes')
export class DisputeController {
  private readonly commands: OrderCommands
  private readonly client: DatabaseService['client']

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.commands = new OrderCommands(database.client)
    this.client = database.client
  }

  private requireAdmin(request: AuthRequest) {
    if (request.auth.account.role !== 'admin') throw new DomainError('FORBIDDEN')
  }

  @Post()
  @HttpCode(200)
  async list(@Req() request: AuthRequest) {
    this.requireAdmin(request)
    const orders = await this.client.order.findMany({
      where: { status: 'issue', refundBuyerRows: { some: { status: 'pending' } } },
      include: { snapshot: true, eventOrderRows: { where: { operation: 'counteroffer' } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50
    })
    return {
      items: orders.map((order) => ({
        id: order.id,
        title: order.snapshot?.title,
        status: order.status,
        currency: order.snapshot?.currency,
        amount: order.snapshot?.priceAmount.toFixed(),
        hasCounteroffer: order.eventOrderRows.length > 0
      }))
    }
  }

  @Post(':id')
  @HttpCode(200)
  async detail(@Req() request: AuthRequest, @Param('id') id: string) {
    this.requireAdmin(request)
    const orderId = idInput(id)
    const order = await this.client.order.findUnique({
      where: { id: orderId },
      include: {
        snapshot: true,
        issueOrderRows: true,
        refundBuyerRows: true,
        eventOrderRows: { where: { operation: 'counteroffer' } }
      }
    })
    if (!order || order.issueOrderRows.length === 0) throw new DomainError('NOT_FOUND')
    return {
      id: order.id,
      status: order.status,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      title: order.snapshot?.title,
      type: order.snapshot?.type,
      price: order.snapshot && {
        amount: order.snapshot.priceAmount.toFixed(),
        currency: order.snapshot.currency
      },
      issue: order.issueOrderRows[0]?.description ?? null,
      refundRequested: order.refundBuyerRows.some((refund) => refund.status === 'pending'),
      counteroffer: order.eventOrderRows[0]?.note ?? null
    }
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | string[] | undefined,
    @Body() body: unknown
  ) {
    this.requireAdmin(request)
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(key))
      throw new DomainError('INVALID_INPUT')
    const input = objectInput(body, ['outcome', 'returnOutcome'], ['outcome'])
    if (input.outcome !== 'refund' && input.outcome !== 'release')
      throw new DomainError('INVALID_INPUT')
    if (input.returnOutcome !== undefined &&
      !['not_sent', 'returned', 'not_required'].includes(String(input.returnOutcome)))
      throw new DomainError('INVALID_INPUT')
    if (input.outcome === 'release' && input.returnOutcome !== undefined)
      throw new DomainError('INVALID_INPUT')
    return {
      orderId: await this.commands.resolveDispute(
        request.auth.account.id,
        key,
        idInput(id),
        {
          outcome: input.outcome,
          ...(input.returnOutcome ? { returnOutcome: String(input.returnOutcome) } : {})
        }
      )
    }
  }
}
