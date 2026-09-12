import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Public, type AuthRequest } from '../auth/auth.guard.js'
import { currencyCodes, scales } from '../pricing/currencies.js'
import { ListingService } from './listing.service.js'

@Controller()
export class ListingController {
  constructor(@Inject(ListingService) private readonly listings: ListingService) {}

  @Public()
  @Get('currencies')
  currencies() {
    return currencyCodes.map((code) => ({ code, scale: scales[code] }))
  }

  @Public()
  @Get('listings')
  list(@Query() query: unknown) {
    return this.listings.list(query)
  }

  @Public()
  @Get('listings/:id')
  detail(@Param('id') id: string) {
    return this.listings.detail(id)
  }

  @Get('me/listings')
  own(@Req() request: AuthRequest, @Query() query: unknown) {
    return this.listings.list(query, request.auth.account.id)
  }

  @Post('listings')
  create(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.listings.create(request.auth.account.id, body)
  }

  @Patch('listings/:id')
  edit(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.listings.edit(request.auth.account.id, id, body)
  }
}
