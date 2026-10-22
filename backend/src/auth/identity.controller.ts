import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common'
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator'
import { type FastifyReply } from 'fastify'
import { AuthService } from './auth.service.js'
import { GoogleAuthService } from './google-auth.service.js'
import { EmailAuthService } from './email-auth.service.js'
import { Public, type AuthRequest } from './auth.guard.js'
import { DomainError } from '../common/domain-error.js'

class GoogleStartInput {
  @IsOptional() @IsString() @Length(1, 255) returnTo?: string
}
class GoogleBindInput extends GoogleStartInput {
  @IsOptional() @IsString() password?: string
}
class EmailRequestInput {
  @IsEmail() email!: string
  @IsOptional() @IsIn(['zh-CN', 'en']) locale?: 'zh-CN' | 'en'
}
class EmailVerifyInput {
  @IsEmail() email!: string
  @IsString() @Length(6, 6) code!: string
}
class EmailBindRequestInput extends EmailRequestInput {
  @IsOptional() @IsString() password?: string
}

@Controller('auth')
export class IdentityController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(GoogleAuthService) private readonly google: GoogleAuthService,
    @Inject(EmailAuthService) private readonly email: EmailAuthService
  ) {}

  @Public() @Get('methods') @Header('Cache-Control', 'no-store')
  methods() { return { password: true, google: this.google.enabled, emailCode: this.email.enabled } }

  @Get('identities') @Header('Cache-Control', 'no-store')
  async identities(@Req() request: AuthRequest) {
    const accountId = request.auth.account.id
    const [identities, credential] = await Promise.all([
      this.auth.client.accountIdentity.findMany({ where: { accountId }, select: { provider: true } }),
      this.auth.client.accountCredential.findUnique({ where: { accountId }, select: { accountId: true } })
    ])
    return {
      google: identities.some(identity => identity.provider === 'google'),
      email: identities.some(identity => identity.provider === 'email'),
      hasPassword: Boolean(credential)
    }
  }

  @Public() @Post('google/start') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async googleStart(@Body() input: GoogleStartInput, @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.google.start(input.returnTo, 'login', request.ip)
    reply.header('Set-Cookie', result.cookie)
    return { authorizationUrl: result.authorizationUrl }
  }

  @Post('google/bind/start') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async googleBindStart(@Body() input: GoogleBindInput, @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.requireRecentAccountProof(request.auth, input.password, request.ip)
    const result = await this.google.start(input.returnTo, 'bind', request.ip, request.auth.account.id)
    reply.header('Set-Cookie', result.cookie)
    return { authorizationUrl: result.authorizationUrl }
  }

  @Public() @Get('google/callback')
  async googleCallback(@Query('state') state: string, @Query('code') code: string,
    @Req() request: AuthRequest, @Res() reply: FastifyReply) {
    let location: string
    try {
      const result = await this.google.complete(state, code, request.headers.cookie)
      reply.header('Set-Cookie', [this.auth.cookie(result.auth.token), this.google.cookie('', true)])
      location = `${this.auth.config.appOrigin}${result.returnTo}`
    } catch (error) {
      const publicCode = error instanceof DomainError &&
        ['ACCOUNT_LINK_REQUIRED', 'GOOGLE_UNAVAILABLE', 'FORBIDDEN', 'GOOGLE_INVALID']
          .includes(error.code) ? error.code : 'GOOGLE_INVALID'
      reply.header('Set-Cookie', this.google.cookie('', true))
      location = `${this.auth.config.appOrigin}/${this.google.callbackLocale(request.headers.cookie)}/login?authError=${publicCode}`
    }
    reply.header('Cache-Control', 'no-store')
    return reply.redirect(location, 302)
  }

  @Public() @Post('email/request') @HttpCode(202) @Header('Cache-Control', 'no-store')
  async emailRequest(@Body() input: EmailRequestInput, @Req() request: AuthRequest) {
    await this.email.request(input.email, input.locale ?? 'zh-CN', request.ip)
    return { accepted: true }
  }

  @Public() @Post('email/verify') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async emailVerify(@Body() input: EmailVerifyInput, @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply) {
    const auth = await this.email.verify(input.email, input.code, request.ip, request.headers.cookie)
    reply.header('Set-Cookie', this.auth.cookie(auth.token))
    return this.auth.view(auth)
  }

  @Post('email/bind/request') @HttpCode(202) @Header('Cache-Control', 'no-store')
  async emailBindRequest(@Body() input: EmailBindRequestInput, @Req() request: AuthRequest) {
    if (!this.email.enabled) throw new DomainError('EMAIL_UNAVAILABLE')
    await this.auth.requireRecentAccountProof(request.auth, input.password, request.ip)
    await this.email.request(input.email, input.locale ?? 'zh-CN', request.ip,
      'bind', request.auth.account.id)
    return { accepted: true }
  }

  @Post('email/bind/verify') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async emailBindVerify(@Body() input: EmailVerifyInput, @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply) {
    const auth = await this.email.verify(input.email, input.code, request.ip,
      request.headers.cookie, 'bind', request.auth.account.id)
    reply.header('Set-Cookie', this.auth.cookie(auth.token))
    return this.auth.view(auth)
  }
}
