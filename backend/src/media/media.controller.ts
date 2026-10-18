import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common'
import { type AuthRequest } from '../auth/auth.guard.js'
import { MediaService } from './media.service.js'

@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post('upload-intents')
  createIntent(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.media.createIntent(request.auth.account.id, body)
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.media.complete(request.auth.account.id, id)
  }
}
