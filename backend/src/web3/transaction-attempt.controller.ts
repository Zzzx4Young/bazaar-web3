import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req
} from '@nestjs/common'
import { AuthService } from '../auth/auth.service.js'
import type { AuthRequest } from '../auth/auth.guard.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput } from '../common/input.js'
import { idempotencyKey } from '../orders/idempotency-key.js'
import { TransactionAttemptService } from './transaction-attempt.js'
@Controller('web3')
export class TransactionAttemptController {
  constructor(
    @Inject(TransactionAttemptService) readonly attempts: TransactionAttemptService | null,
    @Inject(AuthService) readonly auth: AuthService
  ) {}
  private async enabled(request: AuthRequest) {
    if (!this.attempts) throw new DomainError('WALLET_UNAVAILABLE')
    await this.auth.rateLimitWallet('attempt:' + request.ip)
    return this.attempts
  }
  @Post('orders/:id/transaction-attempts')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async report(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    const input = objectInput(body, ['txHash'])
    if (typeof input.txHash !== 'string') throw new DomainError('INVALID_INPUT')
    return (await this.enabled(request)).reportAttempt(
      request.auth,
      idInput(id).toLowerCase(),
      input.txHash,
      idempotencyKey(key)
    )
  }
  @Post('transaction-attempts/:id/refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    objectInput(body, [], [])
    return (await this.enabled(request)).refreshAttempt(request.auth, idInput(id).toLowerCase())
  }
}
