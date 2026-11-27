import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common'
import { IsUUID, Matches } from 'class-validator'
import type { Hex } from 'viem'
import { AuthService } from '../auth/auth.service.js'
import { Public, type AuthRequest } from '../auth/auth.guard.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput, positiveInteger } from '../common/input.js'
import { DatabaseService } from '../database/database.service.js'
import { PaymentIntentService } from './payment-intent.service.js'
import { idempotencyKey } from '../orders/idempotency-key.js'
import { ListingService } from '../listings/listing.service.js'
import { SellerPayoutService, existingOrderTerms } from './seller-payout.service.js'

class PayoutConfirmInput {
  @IsUUID('4') id!: string
  @Matches(/^0x[0-9a-fA-F]{130}$/) signature!: Hex
}

@Controller('web3')
export class TestnetController {
  constructor(@Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ListingService) private readonly listings: ListingService,
    @Inject(SellerPayoutService) private readonly payout: SellerPayoutService | null,
    @Inject(PaymentIntentService) private readonly payments: PaymentIntentService | null) {}

  private enabled() {
    if (!this.payout) throw new DomainError('WALLET_UNAVAILABLE')
    return this.payout
  }
  @Public() @Get('config') @Header('Cache-Control', 'no-store')
  config() {
    const config = this.auth.config.web3
    return config ? { enabled: true, chainId: config.chainId, token: config.token, escrow: config.escrow,
      currency: 'BZTEST', decimals: 6 } : { enabled: false }
  }
  @Post('payout/confirm') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async confirm(@Body() input: PayoutConfirmInput, @Req() request: AuthRequest) {
    const payout = this.enabled()
    await this.auth.rateLimitWallet(request.ip)
    return payout.confirmSellerPayout(request.auth, input.id, input.signature)
  }
  @Public() @Post('payout/reconcile') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async reconcile(@Body() input: PayoutConfirmInput, @Req() request: AuthRequest) {
    const payout = this.enabled()
    await this.auth.rateLimitWallet(request.ip)
    return payout.reconcileSellerPayout(request.headers.cookie, input.id, input.signature,
      request.headers['x-csrf-token'])
  }
  @Post('listings/:id/price') @HttpCode(200) @Header('Cache-Control', 'no-store')
  price(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    this.enabled()
    const input = objectInput(body, ['version', 'amount'])
    return this.listings.edit(request.auth.account.id, idInput(id), {
      version: positiveInteger(input.version), testnetPriceAmount: input.amount })
  }
  @Post('orders') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async create(@Body() body: unknown, @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined) {
    this.enabled()
    if (!this.payments) throw new DomainError('WALLET_UNAVAILABLE')
    await this.auth.rateLimitWallet('payment:'+request.ip)
    const input = objectInput(body, ['listingId', 'version'])
    return this.payments.createOrder(request.auth,idempotencyKey(key), {
      listingId: idInput(input.listingId).toLowerCase(),version: positiveInteger(input.version) })
  }
  @Post('orders/:id/terms') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async terms(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    objectInput(body, [], [])
    const orderId = idInput(id)
    const snapshot = await existingOrderTerms(this.db.client, request.auth.account.id, orderId)
    const [terms, intent] = await Promise.all([
      this.db.client.paymentOrderTerms.findUnique({ where: { orderId } }),
      this.db.client.paymentIntent.findFirst({ where: { orderId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    ])
    return { ...snapshot, payment: terms?.terms ?? null, intentId: intent?.id ?? null }
  }
}
