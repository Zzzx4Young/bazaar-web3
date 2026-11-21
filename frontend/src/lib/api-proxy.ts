import { randomUUID } from 'node:crypto'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const transportCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
])
const hopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]
function stripHopHeaders(headers: Headers) {
  const nominated = headers.get('connection')?.split(',') ?? []
  for (const name of [...nominated.map((s) => s.trim()).filter(Boolean), ...hopHeaders]) {
    headers.delete(name)
  }
}
function safeTransportFailure(error: unknown) {
  const codes = new Set<string>(),
    seen = new Set<object>()
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return
    seen.add(value)
    const row = value as { code?: unknown; cause?: unknown; errors?: unknown }
    if (typeof row.code === 'string' && transportCodes.has(row.code)) codes.add(row.code)
    visit(row.cause, depth + 1)
    if (Array.isArray(row.errors)) for (const e of row.errors.slice(0, 8)) visit(e, depth + 1)
  }
  visit(error, 0)
  return { class: error instanceof TypeError ? 'TypeError' : 'Unknown', codes: [...codes] }
}
export interface ProxyLogEntry {
  event: 'proxy_request'
  timestamp: string
  proxyRequestId: string
  applicationRequestId: string | null
  statusSource: 'proxy' | 'application' | 'upstream'
  pid: number
  uid: number | null
  method: string
  route: '/api/:path*'
  status: number
  durationMs: number
  failure?: ReturnType<typeof safeTransportFailure>
}

// This boundary owns proxy IDs. Never trust diagnostic headers supplied by the browser.
// Bodies stream through; no request/response payload, URL, query, cookies or exception text is logged.
export async function proxyApiRequest(
  request: Request,
  origin: string,
  sink: (entry: ProxyLogEntry) => void = (entry) => console.log(JSON.stringify(entry))
): Promise<Response> {
  const proxyRequestId = randomUUID(),
    started = performance.now()
  let applicationRequestId: string | null = null
  let statusSource: ProxyLogEntry['statusSource'] = 'proxy'
  let failure: ProxyLogEntry['failure']
  let response: Response
  const timeout = AbortSignal.timeout(30000)
  try {
    // Assign pathname rather than resolving user input as a URL: //host can never change upstream.
    const incoming = new URL(request.url),
      target = new URL(origin)
    target.pathname = incoming.pathname
    target.search = incoming.search
    const headers = new Headers(request.headers)
    stripHopHeaders(headers)
    for (const name of ['host', 'x-request-id', 'x-application-request-id', 'x-status-source'])
      headers.delete(name)
    headers.set('x-forwarded-host', incoming.host)
    headers.set('x-proxy-request-id', proxyRequestId)
    headers.set('accept-encoding', 'identity')
    const options: RequestInit & { duplex: 'half' } = {
      method: request.method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, timeout]),
      duplex: 'half',
      ...(request.method !== 'GET' && request.method !== 'HEAD' ? { body: request.body } : {})
    }
    const upstream = await fetch(target, options)
    const appId = upstream.headers.get('x-application-request-id')
    applicationRequestId = appId && uuid.test(appId) ? appId : null
    statusSource = applicationRequestId ? 'application' : 'upstream'
    const outgoing = new Headers(upstream.headers)
    stripHopHeaders(outgoing)
    // Fetch decodes compressed responses even if an upstream ignores identity encoding.
    if (outgoing.has('content-encoding')) {
      outgoing.delete('content-encoding')
      outgoing.delete('content-length')
    }
    outgoing.delete('set-cookie')
    for (const cookie of upstream.headers.getSetCookie()) outgoing.append('set-cookie', cookie)
    outgoing.delete('x-request-id')
    outgoing.delete('x-application-request-id')
    if (applicationRequestId) outgoing.set('x-application-request-id', applicationRequestId)
    response = new Response(upstream.body, { status: upstream.status, headers: outgoing })
  } catch (error) {
    statusSource = 'proxy'
    applicationRequestId = null
    failure = timeout.aborted
      ? { class: 'TimeoutError', codes: ['ETIMEDOUT'] }
      : safeTransportFailure(error)
    response = Response.json(
      { error: { code: 'UPSTREAM_UNAVAILABLE', requestId: proxyRequestId } },
      { status: 502 }
    )
  }
  response.headers.set('x-proxy-request-id', proxyRequestId)
  response.headers.set('x-request-id', applicationRequestId ?? proxyRequestId)
  response.headers.set('x-status-source', statusSource)
  // Log the HTTP status selected at the response-header boundary, not body completion.
  try {
    sink({
      event: 'proxy_request',
      timestamp: new Date().toISOString(),
      proxyRequestId,
      applicationRequestId,
      statusSource,
      pid: process.pid,
      uid: process.getuid?.() ?? null,
      method: request.method,
      route: '/api/:path*',
      status: response.status,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
      ...(failure ? { failure } : {})
    })
  } catch {
    /* Logging must not replace the response. */
  }
  return response
}
