import { Controller, Get, Inject, Param, Req, Res, StreamableFile } from '@nestjs/common'
import { type FastifyReply } from 'fastify'
import { Public } from '../auth/auth.guard.js'
import { type AuthRequest } from '../auth/auth.guard.js'
import { MediaService } from './media.service.js'

@Controller()
export class MediaReadController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Public()
  @Get('listings/:listingId/media/:mediaId')
  async listing(
    @Param('listingId') listingId: string,
    @Param('mediaId') mediaId: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const { bytes, contentType } = await this.media.readListing(listingId, mediaId)
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Content-Type', contentType)
    return new StreamableFile(bytes)
  }

  @Get('orders/:orderId/media/:mediaId')
  async order(
    @Param('orderId') orderId: string,
    @Param('mediaId') mediaId: string,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const { bytes, contentType } = await this.media.readOrder(
      orderId, mediaId, request.auth.account.id
    )
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Content-Type', contentType)
    return new StreamableFile(bytes)
  }
}
