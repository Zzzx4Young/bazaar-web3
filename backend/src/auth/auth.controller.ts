import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import { IsString, Length } from 'class-validator'
import { type FastifyReply } from 'fastify'
import { AuthService } from './auth.service.js'
import { NoCsrf, Public, type AuthRequest } from './auth.guard.js'
import { DomainError } from '../common/domain-error.js'

class LoginInput {
  @IsString() @Length(3, 100) loginName!: string
  @IsString() @Length(15, 128) password!: string
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() input: LoginInput,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const auth = await this.auth.login(
      input.loginName,
      input.password,
      request.ip,
      request.headers.cookie
    )
    reply.header('Set-Cookie', this.auth.cookie(auth.token))
    return this.auth.view(auth)
  }

  @HttpCode(200)
  @Post('session')
  @NoCsrf()
  session(@Req() request: AuthRequest) {
    return this.auth.view(request.auth)
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length)
      throw new DomainError('INVALID_INPUT')
    await this.auth.logout(request.auth)
    reply.header('Set-Cookie', this.auth.cookie('', true))
  }
}
