import { safeFailure } from './failure-diagnostics.js'
import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

export interface RequestLogEntry {
  event: 'http_request'
  timestamp: string
  requestId: string
  applicationRequestId: string
  proxyRequestId: string | null
  statusSource: 'application'
  pid: number
  uid: number | null
  method: string
  route: string
  status: number
  durationMs: number
  errorCode?: string
  failure?: ReturnType<typeof safeFailure>
}

export type RequestLogSink = (entry: RequestLogEntry) => void

interface RequestState {
  proxyRequestId: string | null
  startedAt: bigint
  errorCode?: string
  failure?: ReturnType<typeof safeFailure>
}

export class RequestTelemetry {
  private readonly states = new WeakMap<FastifyRequest, RequestState>()

  start(request: FastifyRequest, reply: FastifyReply) {
    const supplied = request.headers['x-request-id']
    request.id =
      typeof supplied === 'string' && requestIdPattern.test(supplied) ? supplied : randomUUID()
    const proxyId = request.headers['x-proxy-request-id']
    const proxyRequestId =
      typeof proxyId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proxyId)
        ? proxyId
        : null
    this.states.set(request, { startedAt: process.hrtime.bigint(), proxyRequestId })
    reply.header('X-Application-Request-Id', request.id)
    reply.header('X-Status-Source', 'application')
    reply.header('X-Request-Id', request.id)
  }

  setError(request: FastifyRequest, code: string, error?: unknown) {
    const state = this.states.get(request)
    if (state) {
      state.errorCode = code
      if (code === 'INTERNAL_ERROR') state.failure = safeFailure(error)
    }
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
      applicationRequestId: request.id,
      proxyRequestId: state?.proxyRequestId ?? null,
      statusSource: 'application',
      pid: process.pid,
      uid: process.getuid?.() ?? null,
      method: request.method,
      route: request.routeOptions?.url ?? 'unmatched',
      status: reply.statusCode,
      durationMs,
      ...(state?.errorCode ? { errorCode: state.errorCode } : {}),
      ...(state?.failure ? { failure: state.failure } : {})
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
