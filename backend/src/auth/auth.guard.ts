import { type CanActivate, type ExecutionContext, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type FastifyRequest, type FastifyReply } from 'fastify'
import { DomainError } from '../common/domain-error.js'
import { AuthService, type Authenticated } from './auth.service.js'

export const Public = () => SetMetadata('publicRoute', true)
export const NoCsrf = () => SetMetadata('noCsrf', true)
export interface AuthRequest extends FastifyRequest {
  auth: Authenticated
}

export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>()
    const reply = context.switchToHttp().getResponse<FastifyReply>()
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    if (write) {
      if (request.headers.origin !== this.auth.config.appOrigin)
        throw new DomainError('ORIGIN_REJECTED')
      if (
        request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
      )
        throw new DomainError('JSON_REQUIRED')
    }
    const publicRoute = this.reflector.getAllAndOverride<boolean>('publicRoute', [
      context.getHandler(),
      context.getClass()
    ])
    if (publicRoute) return true
    reply.header('Cache-Control', 'no-store')
    request.auth = await this.auth.authenticate(request.headers.cookie)
    const noCsrf = this.reflector.getAllAndOverride<boolean>('noCsrf', [context.getHandler(), context.getClass()])
    if (write && !noCsrf) this.auth.checkCsrf(request.auth, request.headers['x-csrf-token'])
    return true
  }
}
