import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

export interface RequestLogEntry {
  event: 'http_request'
  timestamp: string
  requestId: string
  method: string
  route: string
  status: number
  durationMs: number
  errorCode?: string
}

export type RequestLogSink = (entry: RequestLogEntry) => void

interface RequestState {
  startedAt: bigint
  errorCode?: string
}

export class RequestTelemetry {
  private readonly states = new WeakMap<FastifyRequest, RequestState>()

  start(request: FastifyRequest, reply: FastifyReply) {
    const supplied = request.headers['x-request-id']
    request.id = typeof supplied === 'string' && requestIdPattern.test(supplied) ? supplied : randomUUID()
    this.states.set(request, { startedAt: process.hrtime.bigint() })
    reply.header('X-Request-Id', request.id)
  }

  setError(request: FastifyRequest, code: string) {
    const state = this.states.get(request)
    if (state) state.errorCode = code
  }

  finish(request: FastifyRequest, reply: FastifyReply, sink: RequestLogSink | false) {
    if (!sink) return
    const state = this.states.get(request)
    const durationMs = state
      ? Math.round((Number(process.hrtime.bigint() - state.startedAt) / 1_000_000) * 1000) / 1000
      : 0
    const entry: RequestLogEntry = {
      event: 'http_request',
      timestamp: new Date().toISOString(),
      requestId: request.id,
      method: request.method,
      route: request.routeOptions?.url ?? 'unmatched',
      status: reply.statusCode,
      durationMs,
      ...(state?.errorCode ? { errorCode: state.errorCode } : {})
    }
    try {
      sink(entry)
    } catch {
      console.error(JSON.stringify({ event: 'request_log_failed', requestId: request.id }))
    } finally {
      this.states.delete(request)
    }
  }
}

export const defaultRequestLogSink: RequestLogSink = (entry) => {
  console.log(JSON.stringify(entry))
}
