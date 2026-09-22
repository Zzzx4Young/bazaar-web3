import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common'
import { Public, type AuthRequest } from '../auth/auth.guard.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput } from '../common/input.js'
import { DatabaseService } from '../database/database.service.js'
import { transact } from '../database/transaction.js'

@Controller()
export class SellerReviewController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Public()
  @Post('sellers/:id/profile')
  @HttpCode(200)
  async profile(@Param('id') rawId: string) {
    const id = idInput(rawId)
    const seller = await this.database.client.account.findUnique({ where: { id } })
    if (!seller || seller.role !== 'participant') throw new DomainError('NOT_FOUND')
    const ratings = await this.database.client.sellerReview.aggregate({
      where: { sellerId: id },
      _avg: { rating: true },
      _count: { rating: true }
    })
    return {
      id: seller.id,
      displayName: seller.displayName,
      reputation: {
        rating: ratings._avg.rating === null ? null : ratings._avg.rating.toFixed(2),
        ratingCount: ratings._count.rating
      }
    }
  }

  @Post('orders/:id/review')
  @HttpCode(200)
  async review(@Req() request: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    const orderId = idInput(rawId)
    const input = objectInput(body, ['rating'], ['rating'])
    const rating = input.rating
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)
      throw new DomainError('INVALID_INPUT')
    const buyerId = request.auth.account.id
    return transact(this.database.client, async (tx) => {
      await requireActiveAccount(tx, buyerId)
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (!order) throw new DomainError('NOT_FOUND')
      if (order.buyerId !== buyerId) throw new DomainError('FORBIDDEN')
      if (order.status !== 'completed') throw new DomainError('STATE_CONFLICT')
      const previous = await tx.sellerReview.findUnique({ where: { orderId } })
      if (previous) {
        if (previous.rating !== rating) throw new DomainError('STATE_CONFLICT')
        return { orderId }
      }
      await tx.sellerReview.create({
        data: { orderId, buyerId, sellerId: order.sellerId, rating }
      })
      return { orderId }
    })
  }
}
