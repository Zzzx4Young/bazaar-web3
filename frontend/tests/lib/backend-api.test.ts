import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendError, backendErrorMessage, backendPost } from '@/lib/backend-api'

afterEach(() => vi.unstubAllGlobals())

describe('backend request correlation', () => {
  it('sends a request ID and exposes the correlated error details', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
      return new Response(
        JSON.stringify({ code: 'UNAVAILABLE', retryable: true, requestId: 'server-request-1' }),
        { status: 409, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'server-request-1' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(backendPost('/listings/search')).rejects.toEqual(
      expect.objectContaining<Partial<BackendError>>({
        code: 'UNAVAILABLE',
        status: 409,
        requestId: 'server-request-1',
        retryable: true
      })
    )
  })

  it('formats the stable code and request ID for tester-visible errors', () => {
    expect(backendErrorMessage(new BackendError('UNAVAILABLE', 503, 'request-123', true))).toBe(
      'UNAVAILABLE · Request ID: request-123'
    )
    expect(backendErrorMessage(new Error('NETWORK_ERROR'))).toBe('NETWORK_ERROR')
  })

  it('keeps the sent request ID when the response is lost', async () => {
    let sentRequestId: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentRequestId = new Headers(init?.headers).get('X-Request-Id')
        throw new TypeError('connection lost')
      })
    )

    await expect(backendPost('/orders')).rejects.toEqual(
      expect.objectContaining<Partial<BackendError>>({
        code: 'NETWORK_ERROR',
        status: 0,
        requestId: sentRequestId,
        retryable: true
      })
    )
    expect(sentRequestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
