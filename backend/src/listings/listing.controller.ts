import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common'
import { Public, type AuthRequest } from '../auth/auth.guard.js'
import { currencyCodes, scales } from '../pricing/currencies.js'
import { ListingService } from './listing.service.js'

@Controller()
export class ListingController {
  constructor(@Inject(ListingService) private readonly listings: ListingService) {}

  @Public()
  @Post('currencies')
  @HttpCode(200)
  currencies() {
    return currencyCodes.map((code) => ({ code, scale: scales[code] }))
  }

  @Public()
  @Post('listings/search')
  @HttpCode(200)
  list(@Body() query: unknown) {
    return this.listings.list(query)
  }

  @Public()
  @Post('listings/:id/detail')
  @HttpCode(200)
  detail(@Param('id') id: string) {
    return this.listings.detail(id)
  }

  @Post('me/listings')
  @HttpCode(200)
  own(@Req() request: AuthRequest, @Body() query: unknown) {
    return this.listings.list(query, request.auth.account.id)
  }

  @Post('listings')
  create(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.listings.create(request.auth.account.id, body)
  }

  @Post('listings/:id/edit')
  @HttpCode(200)
  edit(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.listings.edit(request.auth.account.id, id, body)
  }
}
