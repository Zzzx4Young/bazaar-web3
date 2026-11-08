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
import { idempotencyKey } from '../orders/idempotency-key.js'
import { PrivateFileService } from './upload.service.js'

@Controller('web3/private-files')
export class PrivateFileController {
  constructor(
    @Inject(PrivateFileService) private readonly files: PrivateFileService | null,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}
  private async enabled(request: AuthRequest) {
    if (!this.files) throw new DomainError('FILE_UNAVAILABLE')
    await this.auth.rateLimitWallet('private-file:' + request.ip)
    return this.files
  }
  @Post('upload-intents')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async create(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string | string[] | undefined
  ) {
    const input = objectInput(body, ['orderId', 'purpose', 'filename', 'contentType', 'byteSize'])
    const { orderId, ...upload } = input
    const result = await (
      await this.enabled(request)
    ).createUpload(
      request.auth.account.id,
      idInput(orderId).toLowerCase(),
      upload,
      idempotencyKey(key)
    )
    return {
      ...result,
      uploadUrl: this.auth.config.privateFiles
        ? this.auth.config.privateFiles.uploadOrigin + result.uploadPath
        : null
    }
  }
  @Post(':id/complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async complete(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    objectInput(body, [], [])
    return (await this.enabled(request)).completeUpload(
      request.auth.account.id,
      idInput(id).toLowerCase()
    )
  }
  @Post(':id/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async status(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest) {
    objectInput(body, [], [])
    return (await this.enabled(request)).status(request.auth.account.id, idInput(id).toLowerCase())
  }
}
