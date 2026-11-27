// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { proxyApiRequest } from '../src/lib/api-proxy'
import { backendPost, BackendError } from '../src/lib/backend-api'
import { apiErrorCopy } from '../src/lib/api-error-copy'

const servers: Server[] = []
afterEach(async () => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const s of servers.splice(0)) {
    s.closeAllConnections()
    await new Promise<void>((resolve) => s.close(() => resolve()))
  }
})
async function listen(s: Server) {
  servers.push(s)
  s.listen(0, '127.0.0.1')
  await once(s, 'listening')
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`
}

test('API down yields attributable proxy 502 and safe ECONNREFUSED diagnostics', async () => {
  const s = createServer()
  const origin = await listen(s)
  await new Promise<void>((resolve) => s.close(() => resolve()))
  const logs: unknown[] = []
  const res = await proxyApiRequest(
    new Request('http://front/api/orders/private?token=secret', {
      method: 'POST',
      headers: { cookie: 'secret', 'x-proxy-request-id': 'secret' },
      body: 'secret'
    }),
    origin,
    (entry) => logs.push(entry)
  )
  expect(res.status).toBe(502)
  expect(res.headers.get('x-status-source')).toBe('proxy')
  expect(res.headers.get('x-application-request-id')).toBeNull()
  expect(res.headers.get('x-request-id')).toBe(res.headers.get('x-proxy-request-id'))
  expect(res.headers.get('x-proxy-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  expect(logs[0]).toMatchObject({
    status: 502,
    statusSource: 'proxy',
    applicationRequestId: null,
    pid: process.pid,
    uid: process.getuid?.(),
    failure: { class: 'TypeError', codes: ['ECONNREFUSED'] }
  })
  expect(JSON.stringify(logs)).not.toContain('secret')
  expect(JSON.stringify(logs)).not.toContain('private')
  expect(await res.json()).toEqual({
    code: 'UNAVAILABLE', retryable: true, requestId: res.headers.get('x-proxy-request-id')
  })
})

test('application 500 stays application 500 with distinct IDs; redirects/cookies/body are preserved', async () => {
  let seen: {
    url?: string
    body?: string
    proxyId?: string
    requestId?: string
    cookie?: string
    authorization?: string
    origin?: string
    forwardedHost?: string
  } = {}
  const appId = '12345678-1234-4234-8234-123456789abc'
  const origin = await listen(
    createServer(async (req, res) => {
      let body = ''
      for await (const b of req) body += b
      seen = {
        url: req.url,
        body,
        proxyId: req.headers['x-proxy-request-id'] as string,
        requestId: req.headers['x-request-id'] as string,
        cookie: req.headers.cookie,
        authorization: req.headers.authorization,
        origin: req.headers.origin,
        forwardedHost: req.headers['x-forwarded-host'] as string
      }
      res.writeHead(req.url?.includes('redirect') ? 302 : 500, {
        'x-request-id': appId,
        'x-application-request-id': appId,
        'set-cookie': ['one=1; HttpOnly; Path=/', 'two=2; HttpOnly; Path=/'],
        location: '/zh-CN/login',
        'content-type': 'application/json'
      })
      res.end('{"error":"opaque"}')
    })
  )
  for (const path of ['/api/test?q=1', '/api/redirect']) {
    const logs: unknown[] = []
    const res = await proxyApiRequest(
      new Request('http://front' + path, {
        method: 'POST',
        headers: {
          'x-request-id': 'spoof',
          'x-proxy-request-id': 'spoof',
          cookie: 'session=secret',
          authorization: 'Bearer secret',
          origin: 'http://front'
        },
        body: 'payload'
      }),
      origin,
      (entry) => logs.push(entry)
    )
    expect(res.status).toBe(path.includes('redirect') ? 302 : 500)
    expect(seen.url).toBe(path)
    expect(seen.body).toBe('payload')
    expect(seen.requestId).toBeUndefined()
    expect(seen.cookie).toBe('session=secret')
    expect(seen.authorization).toBe('Bearer secret')
    expect(seen.origin).toBe('http://front')
    expect(seen.forwardedHost).toBe('front')
    expect(JSON.stringify(logs)).not.toContain('secret')
    expect(seen.proxyId).toBe(res.headers.get('x-proxy-request-id'))
    expect(res.headers.get('x-request-id')).toBe(appId)
    expect(res.headers.get('x-status-source')).toBe('application')
    expect(res.headers.get('x-proxy-request-id')).not.toBe(appId)
    expect(res.headers.getSetCookie()).toHaveLength(2)
    expect(res.headers.get('location')).toBe('/zh-CN/login')
    expect(await res.text()).toBe('{"error":"opaque"}')
    expect(logs[0]).toMatchObject({ statusSource: 'application', applicationRequestId: appId })
  }
})

test('streaming responses start before upstream completes; compressed responses and HEAD/204 survive', async () => {
  const { gzipSync } = await import('node:zlib')
  let finishBody: (() => void) | undefined
  const origin = await listen(
    createServer((req, res) => {
      if (req.url === '/api/stream') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.write('first')
        finishBody = () => res.end('last')
      } else if (req.method === 'HEAD' || req.url === '/api/empty') {
        res.writeHead(req.url === '/api/empty' ? 204 : 200)
        res.end()
      } else {
        const body = gzipSync('decoded')
        res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length })
        res.end(body)
      }
    })
  )
  const response = await proxyApiRequest(new Request('http://front/api/stream'), origin, () => {})
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
  finishBody!()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('last')
  expect((await reader.read()).done).toBe(true)
  const gzip = await proxyApiRequest(new Request('http://front/api/gzip'), origin, () => {})
  expect(gzip.headers.get('content-encoding')).toBeNull()
  expect(gzip.headers.get('content-length')).toBeNull()
  expect(await gzip.text()).toBe('decoded')
  for (const [method, path, status] of [
    ['HEAD', '/api/head', 200],
    ['GET', '/api/empty', 204]
  ] as const) {
    const empty = await proxyApiRequest(
      new Request('http://front' + path, { method }),
      origin,
      () => {}
    )
    expect(empty.status).toBe(status)
    expect(empty.body).toBeNull()
  }
})

test('unattributed upstream response cannot spoof application attribution; sink failure preserves status', async () => {
  const origin = await listen(
    createServer((_req, res) => {
      res.writeHead(503, {
        'x-request-id': 'SECRET',
        'x-application-request-id': 'SECRET',
        'x-status-source': 'application',
        'x-proxy-request-id': 'SECRET'
      })
      res.end('upstream unavailable')
    })
  )
  const logs: unknown[] = []
  const response = await proxyApiRequest(
    new Request('http://front/api/health/live'),
    origin,
    (entry) => {
      logs.push(entry)
      throw new Error('SECRET')
    }
  )
  expect(response.status).toBe(503)
  expect(response.headers.get('x-status-source')).toBe('upstream')
  expect(response.headers.get('x-application-request-id')).toBeNull()
  expect(response.headers.get('x-request-id')).toBe(response.headers.get('x-proxy-request-id'))
  expect(JSON.stringify(logs)).not.toContain('SECRET')
  expect(await response.text()).toBe('upstream unavailable')
})

test('progressing response survives beyond 30 seconds; only idle time expires', async () => {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), ms)
    return controller.signal
  })
  let source!: ReadableStreamDefaultController<Uint8Array>
  let signal!: AbortSignal
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      signal = options.signal
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          source = c
        }
      })
      signal.addEventListener('abort', () => source.error(new Error('PRIVATE upstream error')), {
        once: true
      })
      return new Response(body)
    })
  )
  const response = await proxyApiRequest(
    new Request('http://front/api/media'),
    'http://upstream',
    () => {}
  )
  const reader = response.body!.getReader()
  for (let n = 0; n < 4; n++) {
    await vi.advanceTimersByTimeAsync(10_000)
    expect(signal.aborted).toBe(false)
    source.enqueue(new TextEncoder().encode('part'))
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('part')
  }
  source.close()
  expect((await reader.read()).done).toBe(true)
  await vi.advanceTimersByTimeAsync(30_001)
  expect(signal.aborted).toBe(false)
})

test('stalled response is aborted after 30 idle seconds and hides the upstream message', async () => {
  vi.useFakeTimers()
  let signal!: AbortSignal
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      signal = options.signal
      const body = new ReadableStream<Uint8Array>({
        start(source) {
          signal.addEventListener(
            'abort',
            () => source.error(new Error('PRIVATE upstream error')),
            { once: true }
          )
        }
      })
      return new Response(body)
    })
  )
  const response = await proxyApiRequest(
    new Request('http://front/api/media'),
    'http://upstream',
    () => {}
  )
  const failure = response.text().catch((error: Error) => error)
  await vi.advanceTimersByTimeAsync(30_001)
  expect(signal.aborted).toBe(true)
  expect((await failure).message).toBe('Upstream transfer interrupted')
})


test('real proxy failures and application errors preserve the parser contract and localized copy', async () => {
  const stopped = createServer()
  const unavailable = await listen(stopped)
  await new Promise<void>((resolve) => stopped.close(() => resolve()))
  const appId = '12345678-1234-4234-8234-123456789abc'
  const available = await listen(createServer((_req, res) => {
    res.writeHead(409, { 'content-type': 'application/json',
      'x-application-request-id': appId })
    res.end(JSON.stringify({ code: 'STATE_CONFLICT', retryable: false, requestId: appId }))
  }))
  const fetchReal = globalThis.fetch
  const logs: unknown[] = []
  let origin = unavailable
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
    typeof input === 'string' && input.startsWith('/api/')
      ? proxyApiRequest(new Request('http://front' + input, init), origin, (e) => logs.push(e))
      : fetchReal(input, init))
  const unavailableError = await backendPost('/web3/orders').catch((error: unknown) => error)
  expect(unavailableError).toBeInstanceOf(BackendError)
  expect(unavailableError).toMatchObject({ code: 'UNAVAILABLE', status: 502, retryable: true })
  expect((unavailableError as BackendError).requestId).toBe(
    (logs[0] as { proxyRequestId: string }).proxyRequestId)
  expect(apiErrorCopy(unavailableError, 'zh-CN')).toBe('当前资源暂不可用，请刷新后重试。')
  expect(apiErrorCopy(unavailableError, 'en')).toBe(
    'This resource is currently unavailable. Refresh and try again.')
  origin = available
  const appError = await backendPost('/web3/orders').catch((error: unknown) => error)
  expect(appError).toMatchObject({ code: 'STATE_CONFLICT', status: 409,
    retryable: false, requestId: appId })
  expect(apiErrorCopy(appError, 'zh-CN')).not.toContain(appId)
  expect(JSON.stringify(logs)).not.toContain('STATE_CONFLICT')
})
