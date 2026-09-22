import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { type AuthRequest } from '../auth/auth.guard.js'
import { DatabaseService } from '../database/database.service.js'

@Controller('balances')
export class BalanceController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Post()
  @HttpCode(200)
  async list(@Req() request: AuthRequest) {
    const accountId = request.auth.account.id
    const rows = await this.database.client.$queryRaw<
      Array<{ currency: string; amount: Prisma.Decimal }>
    >`
      SELECT s.currency,
        SUM(CASE
          WHEN s.operation = 'payment' AND o."buyerId" = ${accountId}::uuid THEN -s.amount
          WHEN s.operation = 'refund' AND o."buyerId" = ${accountId}::uuid THEN s.amount
          WHEN s.operation = 'release' AND o."sellerId" = ${accountId}::uuid THEN s.amount
          ELSE 0
        END) AS amount
      FROM "SettlementRecord" s
      JOIN "Order" o ON o.id = s."orderId"
      WHERE o."buyerId" = ${accountId}::uuid OR o."sellerId" = ${accountId}::uuid
      GROUP BY s.currency
      ORDER BY s.currency`
    return {
      items: rows.map((row) => ({
        currency: row.currency,
        amount: row.amount.toFixed(),
        mode: 'simulated' as const
      }))
    }
  }
}
