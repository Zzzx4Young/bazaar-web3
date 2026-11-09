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
import type { AuthRequest } from '../auth/auth.guard.js'
import { AuthService } from '../auth/auth.service.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput } from '../common/input.js'
import { fileSessionGuard } from '../delivery-files/authorization.js'
import { idempotencyKey } from '../orders/idempotency-key.js'
import { EvidenceService } from './evidence.service.js'

@Controller('web3/orders/:id')
export class EvidenceController {
  constructor(
    @Inject(EvidenceService) private readonly evidence: EvidenceService | null,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}

  private async enabled(request: AuthRequest) {
    if (!this.evidence) throw new DomainError('FILE_UNAVAILABLE')
    await this.auth.rateLimitWallet('evidence:' + request.ip)
    return this.evidence
  }

  @Post('evidence')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async submit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    return (await this.enabled(request)).submitEvidence(
      idInput(id).toLowerCase(),
      request.auth.account.id,
      body,
      idempotencyKey(key),
      fileSessionGuard(request.auth, this.auth)
    )
  }

  @Post('evidence/append')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async append(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    const input = objectInput(
      body,
      ['parentId', 'text', 'versionId', 'deliveryReferenceId', 'consent'],
      ['parentId', 'consent']
    )
    const { parentId, ...submission } = input
    return (await this.enabled(request)).appendEvidence(
      idInput(id).toLowerCase(),
      request.auth.account.id,
      idInput(parentId).toLowerCase(),
      submission,
      idempotencyKey(key),
      fileSessionGuard(request.auth, this.auth)
    )
  }

  @Post('evidence/read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async read(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    objectInput(body, [], [])
    return (await this.enabled(request)).readEvidence(
      idInput(id).toLowerCase(),
      request.auth.account.id,
      fileSessionGuard(request.auth, this.auth)
    )
  }

  @Post('evidence/attachments/authorize')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async authorize(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    const input = objectInput(body, ['evidenceId'])
    return (await this.enabled(request)).authorizeEvidenceAttachment(
      idInput(id).toLowerCase(),
      idInput(input.evidenceId).toLowerCase(),
      request.auth.account.id,
      fileSessionGuard(request.auth, this.auth)
    )
  }

  @Post('review/close')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async close(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    objectInput(body, [], [])
    return (await this.enabled(request)).closeReview(
      idInput(id).toLowerCase(),
      request.auth.account.id,
      idempotencyKey(key),
      fileSessionGuard(request.auth, this.auth)
    )
  }

  @Post('review/reopen')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async reopen(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    objectInput(body, [], [])
    return (await this.enabled(request)).reopenReview(
      idInput(id).toLowerCase(),
      request.auth.account.id,
      idempotencyKey(key),
      fileSessionGuard(request.auth, this.auth)
    )
  }
}
