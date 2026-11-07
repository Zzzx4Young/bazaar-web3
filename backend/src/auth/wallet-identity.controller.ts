import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common'
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator'
import type { FastifyReply } from 'fastify'
import type { Hex } from 'viem'
import { AuthService } from './auth.service.js'
import { Public, type AuthRequest } from './auth.guard.js'
import { WalletAuthService } from './wallet-auth.service.js'
import { WalletReauthService } from './wallet-reauth.service.js'
import { DomainError } from '../common/domain-error.js'
import { idempotencyKey } from '../orders/idempotency-key.js'

class OperationInput {
  @IsIn(['bind', 'unbind', 'payout']) purpose!: 'bind' | 'unbind' | 'payout'
  @Matches(/^0x[0-9a-fA-F]{40}$/) address!: string
}
class PasswordInput extends OperationInput {
  @IsString() @Length(1, 128) password!: string
}
class EmailRequestInput extends OperationInput {
  @IsOptional() @IsIn(['zh-CN', 'en']) locale?: 'zh-CN' | 'en'
}
class EmailVerifyInput {
  @IsUUID('4') id!: string
  @Matches(/^\d{6}$/) code!: string
}
class ActionInput extends OperationInput {
  @IsUUID('4') proofId!: string
}
class ConsumeInput {
  @IsUUID('4') id!: string
  @IsOptional() @Matches(/^0x[0-9a-fA-F]{130}$/) signature?: Hex
}
class LoginChallengeInput {
  @Matches(/^0x[0-9a-fA-F]{40}$/) address!: string
}
class LoginVerifyInput {
  @IsUUID('4') id!: string
  @IsString() @Length(1, 4096) message!: string
  @Matches(/^0x[0-9a-fA-F]{130}$/) signature!: Hex
}

@Controller('auth/wallet')
export class WalletIdentityController {
  constructor(@Inject(AuthService) private readonly auth: AuthService,
    @Inject(WalletAuthService) private readonly wallets: WalletAuthService | null,
    @Inject(WalletReauthService) private readonly reauth: WalletReauthService | null) {}
  private enabled() {
    if (!this.wallets || !this.reauth) throw new DomainError('WALLET_UNAVAILABLE')
    return { wallets: this.wallets, reauth: this.reauth }
  }
  private key(request: AuthRequest) {
    return idempotencyKey(request.headers['idempotency-key'])
  }
  @Post('current') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async current(@Body() body: unknown, @Req() request: AuthRequest) {
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length)
      throw new DomainError('INVALID_INPUT')
    const head = await this.enabled().wallets.current(request.auth)
    return { chainId: head.chainId, address: head.address, bindingVersion: head.bindingVersion }
  }
  @Post('reauth/password') @HttpCode(200) @Header('Cache-Control', 'no-store')
  password(@Body() input: PasswordInput, @Req() request: AuthRequest) {
    return this.enabled().wallets.requestPasswordReauth(request.auth, input.password, input.purpose,
      input.address, this.key(request), request.ip)
  }
  @Post('reauth/email/request') @HttpCode(202) @Header('Cache-Control', 'no-store')
  emailRequest(@Body() input: EmailRequestInput, @Req() request: AuthRequest) {
    return this.enabled().reauth.requestEmail(request.auth, input.purpose, input.address, this.key(request),
      input.locale ?? 'zh-CN', request.ip)
  }
  @Post('reauth/email/verify') @HttpCode(200) @Header('Cache-Control', 'no-store')
  emailVerify(@Body() input: EmailVerifyInput, @Req() request: AuthRequest) {
    return this.enabled().reauth.verifyEmail(request.auth, input.id, input.code, request.ip)
  }
  @Post('reauth/google/start') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async googleStart(@Body() input: OperationInput, @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply) {
    const { cookie, ...result } = await this.enabled().reauth.startGoogle(request.auth, input.purpose,
      input.address, this.key(request), request.ip)
    if (cookie) reply.header('Set-Cookie', cookie)
    return result
  }
  @Get('reauth/google/callback') @Header('Cache-Control', 'no-store')
  async googleCallback(@Query('state') state: string, @Query('code') code: string,
    @Req() request: AuthRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { reauth } = this.enabled()
    await this.auth.rateLimitWallet(request.ip)
    if (typeof state !== 'string' || typeof code !== 'string') throw new DomainError('GOOGLE_INVALID')
    try { return await reauth.completeGoogle(request.auth, state, code, request.headers.cookie ?? '') }
    finally { reply.header('Set-Cookie', reauth.cookie('', true)) }
  }
  @Post('challenge') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async challenge(@Body() input: ActionInput, @Req() request: AuthRequest) {
    const { wallets } = this.enabled()
    await this.auth.rateLimitWallet(request.ip)
    return wallets.createActionChallenge(request.auth, input.proofId, input.purpose, input.address, this.key(request))
  }
  @Post('consume') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async consume(@Body() input: ConsumeInput, @Req() request: AuthRequest) {
    const { wallets } = this.enabled()
    await this.auth.rateLimitWallet(request.ip)
    return wallets.consumeActionChallenge(request.auth, input.id, input.signature)
  }
  @Public() @Post('login/challenge') @HttpCode(200) @Header('Cache-Control', 'no-store')
  loginChallenge(@Body() input: LoginChallengeInput, @Req() request: AuthRequest) {
    return this.enabled().wallets.createLoginChallenge(input.address, request.ip)
  }
  @Public() @Post('login/verify') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async loginVerify(@Body() input: LoginVerifyInput, @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply) {
    const auth = await this.enabled().wallets.verifyLogin(input.id, input.message, input.signature,
      request.ip, request.headers.cookie)
    reply.header('Set-Cookie', this.auth.cookie(auth.token))
    return this.auth.view(auth)
  }
}
