import { afterEach, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useResolvedFavorites } from '@/hooks/use-resolved-favorites'

const liveId = '11111111-1111-4111-8111-111111111111'
const staleId = '22222222-2222-4222-8222-222222222222'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('counts only listings returned by the API, including a favorite beyond search page 1', async () => {
  localStorage.setItem('c2c:user:favorites', JSON.stringify([staleId, liveId]))
  const request = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toEqual({ ids: [staleId, liveId] })
    return { ok: true, status: 200, json: async () => ({
      total: 1,
      items: [{
        id: liveId,
        seller: { id: staleId, displayName: 'Seller' },
        type: 'digital', title: 'Saved listing', description: 'Live listing',
        category: 'digital_assets', price: { amount: '1', currency: 'USD' },
        priceUsd: null, publicationStatus: 'published', availability: 'unlimited',
        version: 1, licenseDescription: null, contentVersion: null,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
      }]
    }) }
  })
  vi.stubGlobal('fetch', request)
  const { result } = renderHook(() => useResolvedFavorites())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.items.map((item) => item.id)).toEqual([liveId])
  expect(request).toHaveBeenCalledTimes(1)
})

it('returns no unconfirmed count when the API fails', async () => {
  localStorage.setItem('c2c:user:favorites', JSON.stringify([liveId]))
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  const { result } = renderHook(() => useResolvedFavorites())
  await waitFor(() => expect(result.current.error).toBe('NETWORK_ERROR'))
  expect(result.current.items).toEqual([])
})
