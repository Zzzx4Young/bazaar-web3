import { afterEach, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBackendListings } from '@/hooks/use-backend-listings'

afterEach(() => vi.unstubAllGlobals())

it('reuses the first price-sort quote when requesting another page', async () => {
  const quoteId = '11111111-1111-4111-8111-111111111111'
  const requests: Record<string, string>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, string>
    requests.push(body)
    return new Response(JSON.stringify({
      items: [], page: Number(body.page), limit: 10, total: 14,
      hasMore: body.page === '1',
      quote: { id: quoteId, base: 'USD', provider: 'Coinbase', fetchedAt: '2026-09-19T00:00:00Z', expiresAt: '2026-09-19T01:00:00Z', sourceAsOf: null }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const params = (page: number) => new URLSearchParams({
    sort: 'price_asc', category: 'digital_assets', limit: '10', page: String(page)
  })
  const { result, rerender } = renderHook(({ page }) => useBackendListings(params(page)), {
    initialProps: { page: 1 }
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await waitFor(() => expect(requests).toHaveLength(1))
  rerender({ page: 2 })
  await waitFor(() => expect(result.current.page).toBe(2))
  expect(requests[1]).toEqual({
    sort: 'price_asc', category: 'digital_assets', limit: '10', page: '2', quoteId
  })
})
