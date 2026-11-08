import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mapApplicationError } from '../common/domain-error.js'
import type { PrivateFileService } from './upload.service.js'

export function createPrivateUploadGateway(files: PrivateFileService, websiteOrigin: string) {
  const attempts = new Map<string, { until: number; count: number }>()
  const server = createServer(async (request, response) => {
    const requestId = randomUUID()
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Request-Id', requestId)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const send = (status: number, code: string) => {
      response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
      response.end(JSON.stringify({ code, retryable: [429, 503].includes(status), requestId }))
    }
    const origin = request.headers.origin
    if (origin !== websiteOrigin || request.headers.cookie) {
      send(403, 'ORIGIN_REJECTED')
      return
    }
    response.setHeader('Access-Control-Allow-Origin', websiteOrigin)
    response.setHeader('Vary', 'Origin')
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'PUT')
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      response.writeHead(204)
      response.end()
      return
    }
    const match = request.url?.match(/^\/uploads\/([0-9a-f-]{36})$/)
    if (request.method !== 'PUT' || !match) {
      send(405, 'INVALID_INPUT')
      return
    }
    const ip = request.socket.remoteAddress ?? 'unknown',
      now = Date.now()
    for (const [address, row] of attempts) if (row.until <= now) attempts.delete(address)
    const record = attempts.get(ip) ?? { until: now + 60000, count: 0 }
    if (record.count >= 30 || (!attempts.has(ip) && attempts.size >= 1024)) {
      send(429, 'RATE_LIMITED')
      return
    }
    record.count++
    attempts.set(ip, record)
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
    const contentType = request.headers['content-type']
    if (!token || !contentType) {
      send(403, 'FORBIDDEN')
      return
    }
    try {
      const result = await files.receive(match[1], token, request, contentType)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result))
    } catch (error) {
      const mapped = mapApplicationError(error)
      if (!response.headersSent) send(mapped.status, mapped.code)
    }
  })
  server.maxConnections = 16
  server.headersTimeout = 10000
  server.requestTimeout = 900000
  server.keepAliveTimeout = 1000
  return server
}
