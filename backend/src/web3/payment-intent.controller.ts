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
import { PaymentIntentService } from './payment-intent.service.js'

@Controller('web3')
export class PaymentIntentController {
  constructor(
    @Inject(PaymentIntentService) private readonly payments: PaymentIntentService | null,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}
  private async enabled(request: AuthRequest) {
    if (!this.payments) throw new DomainError('WALLET_UNAVAILABLE')
    await this.auth.rateLimitWallet('payment:' + request.ip)
    return this.payments
  }
  @Post('payment-intents/:id/read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async read(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    objectInput(body, [], [])
    return (await this.enabled(request)).read(request.auth, idInput(id).toLowerCase())
  }
  @Post('payment-intents/:id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    objectInput(body, [], [])
    return (await this.enabled(request)).requestIntentCancel(
      request.auth,
      idInput(id).toLowerCase(),
      idempotencyKey(key)
    )
  }
  @Post('payment-intents/:id/reconcile')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async reconcile(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    objectInput(body, [], [])
    return (await this.enabled(request)).reconcile(request.auth, idInput(id).toLowerCase())
  }
  @Post('orders/:id/payment-intents/replace')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async replace(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    const input = objectInput(body, ['previousIntentId'])
    return (await this.enabled(request)).replaceIntent(
      request.auth,
      idInput(id).toLowerCase(),
      idempotencyKey(key),
      idInput(input.previousIntentId).toLowerCase()
    )
  }
  @Post('orders/:id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async close(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    objectInput(body, [], [])
    return (await this.enabled(request)).closeOrder(
      request.auth,
      idInput(id).toLowerCase(),
      idempotencyKey(key)
    )
  }
}
