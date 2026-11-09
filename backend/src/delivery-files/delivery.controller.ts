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
import type { Hex } from 'viem'
import { AuthService } from '../auth/auth.service.js'
import type { AuthRequest } from '../auth/auth.guard.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput } from '../common/input.js'
import { idempotencyKey } from '../orders/idempotency-key.js'
import { fileSessionGuard } from './authorization.js'
import { DeliveryPermitService } from './delivery-permit.service.js'
import { DownloadService } from './download.service.js'
import { SupplementPublicationService } from './supplement-publication.service.js'
@Controller('web3/orders')
export class DeliveryController {
  constructor(
    @Inject(DeliveryPermitService) private readonly permits: DeliveryPermitService | null,
    @Inject(DownloadService) private readonly downloads: DownloadService | null,
    @Inject(SupplementPublicationService)
    private readonly publications: SupplementPublicationService | null,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}
  private async enabled(request: AuthRequest) {
    if (!this.downloads) throw new DomainError('FILE_UNAVAILABLE')
    await this.auth.rateLimitWallet('delivery:' + request.ip)
  }
  @Post(':id/delivery/permit')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async permit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    await this.enabled(request)
    if (!this.permits) throw new DomainError('FILE_UNAVAILABLE')
    const b = objectInput(body, ['versionId'])
    return this.permits.issueDeliveryPermit(
      idInput(id).toLowerCase(),
      idInput(b.versionId).toLowerCase(),
      request.auth.account.id,
      idempotencyKey(key),
      fileSessionGuard(request.auth, this.auth)
    )
  }
  @Post(':id/delivery/read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async read(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    await this.enabled(request)
    objectInput(body, [], [])
    return this.downloads!.readDelivery(
      idInput(id).toLowerCase(),
      request.auth.account.id,
      fileSessionGuard(request.auth, this.auth)
    )
  }
  @Post(':id/delivery/download')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async download(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    await this.enabled(request)
    const b = objectInput(body, ['versionId'])
    return this.downloads!.authorizeDownload(
      idInput(id).toLowerCase(),
      idInput(b.versionId).toLowerCase(),
      request.auth.account.id,
      fileSessionGuard(request.auth, this.auth)
    )
  }
  @Post(':id/delivery/supplements/challenge')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async challenge(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    await this.enabled(request)
    if (!this.publications) throw new DomainError('FILE_UNAVAILABLE')
    const b = objectInput(body, ['versionId'])
    const result = await this.publications.createChallenge(
      idInput(id).toLowerCase(),
      idInput(b.versionId).toLowerCase(),
      request.auth.account.id,
      idempotencyKey(key),
      fileSessionGuard(request.auth, this.auth)
    )
    return JSON.parse(
      JSON.stringify(result, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )
  }
  @Post(':id/delivery/supplements/publish')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async publish(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    await this.enabled(request)
    if (!this.publications) throw new DomainError('FILE_UNAVAILABLE')
    const b = objectInput(body, ['versionId', 'authorizationId', 'signature'])
    if (typeof b.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(b.signature))
      throw new DomainError('INVALID_INPUT')
    return this.publications.publishSupplement(
      idInput(id).toLowerCase(),
      idInput(b.versionId).toLowerCase(),
      idInput(b.authorizationId).toLowerCase(),
      b.signature as Hex,
      request.auth.account.id,
      fileSessionGuard(request.auth, this.auth)
    )
  }
}
