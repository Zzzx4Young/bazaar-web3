import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common'
import { type FastifyReply } from 'fastify'
import { mapApplicationError } from './domain-error.js'

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let result = mapApplicationError(error)
    if (error instanceof HttpException) {
      const status = error.getStatus()
      const codes: Record<number, string> = {
        400: 'INVALID_INPUT',
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        413: 'BODY_TOO_LARGE',
        415: 'JSON_REQUIRED',
        429: 'RATE_LIMITED',
        503: 'UNAVAILABLE'
      }
      result = codes[status]
        ? { status, code: codes[status], retryable: status === 503 || status === 429 }
        : result
    }
    const reply = host.switchToHttp().getResponse<FastifyReply>()
    reply.header('Cache-Control', 'no-store')
    if (result.status === 429) reply.header('Retry-After', '60')
    reply.status(result.status).send({ code: result.code, retryable: result.retryable })
  }
}
