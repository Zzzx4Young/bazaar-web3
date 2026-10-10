import { afterEach, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
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
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total: 1,
        items: [
          {
            id: liveId,
            seller: { id: staleId, displayName: 'Seller' },
            type: 'digital',
            title: 'Saved listing',
            description: 'Live listing',
            category: 'digital_assets',
            price: { amount: '1', currency: 'USD' },
            priceUsd: null,
            publicationStatus: 'published',
            availability: 'unlimited',
            version: 1,
            licenseDescription: null,
            contentVersion: null,
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z'
          }
        ]
      })
    }
  })
  vi.stubGlobal('fetch', request)
  const { result } = renderHook(() => useResolvedFavorites())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.items.map((item) => item.id)).toEqual([liveId])
  expect(request).toHaveBeenCalledTimes(1)
})

it('returns no unconfirmed count when the API fails', async () => {
  localStorage.setItem('c2c:user:favorites', JSON.stringify([liveId]))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline')
    })
  )
  const { result } = renderHook(() => useResolvedFavorites())
  await waitFor(() => expect(result.current.error).toBe('NETWORK_ERROR'))
  expect(result.current.items).toEqual([])
})

function deferredRequests() {
  const requests: { ids: string[]; signal: AbortSignal; finish: () => void }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          const signal = init.signal as AbortSignal
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          requests.push({
            ids: JSON.parse(String(init.body)).ids,
            signal,
            finish: () =>
              resolve({ ok: true, status: 200, json: async () => ({ items: [], total: 0 }) })
          })
        })
    )
  )
  return requests
}

it('shares an in-flight resolution and only aborts when its final subscriber leaves', async () => {
  localStorage.setItem('c2c:user:favorites', JSON.stringify([liveId]))
  const requests = deferredRequests()
  const navigation = renderHook(() => useResolvedFavorites())
  const page = renderHook(() => useResolvedFavorites())
  try {
    await waitFor(() => expect(requests).toHaveLength(1))
    navigation.unmount()
    expect(requests[0].signal.aborted).toBe(false)
    page.unmount()
    expect(requests[0].signal.aborted).toBe(true)
  } finally {
    navigation.unmount()
    page.unmount()
  }
})

it('bounds concurrent batches and still resolves every favorite', async () => {
  const ids = Array.from(
    { length: 301 },
    (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  )
  localStorage.setItem('c2c:user:favorites', JSON.stringify(ids))
  const requests = deferredRequests()
  const hook = renderHook(() => useResolvedFavorites())
  try {
    await waitFor(() => expect(requests).toHaveLength(2))
    await act(async () => requests[0].finish())
    await waitFor(() => expect(requests).toHaveLength(3))
    await act(async () => requests[1].finish())
    await waitFor(() => expect(requests).toHaveLength(4))
    await act(async () => {
      requests[2].finish()
      requests[3].finish()
    })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(requests.map((request) => request.ids.length)).toEqual([100, 100, 100, 1])
    expect(requests.flatMap((request) => request.ids)).toEqual(ids)
  } finally {
    hook.unmount()
  }
})

it('does not reuse completed results as a stale cache', async () => {
  localStorage.setItem('c2c:user:favorites', JSON.stringify([liveId]))
  const requests = deferredRequests()
  const first = renderHook(() => useResolvedFavorites())
  await act(async () => requests[0].finish())
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  first.unmount()
  const second = renderHook(() => useResolvedFavorites())
  try {
    await waitFor(() => expect(requests).toHaveLength(2))
    await act(async () => requests[1].finish())
    await waitFor(() => expect(second.result.current.loading).toBe(false))
  } finally {
    second.unmount()
  }
})

it('cancels the obsolete selection without letting its response replace the new result', async () => {
  localStorage.setItem('c2c:user:favorites', JSON.stringify([liveId]))
  const requests = deferredRequests()
  const hook = renderHook(() => useResolvedFavorites())
  try {
    act(() => {
      localStorage.setItem('c2c:user:favorites', JSON.stringify([staleId]))
      window.dispatchEvent(new StorageEvent('storage', { key: 'c2c:user:favorites' }))
    })
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[0].signal.aborted).toBe(true)
    expect(requests[1].ids).toEqual([staleId])
    await act(async () => requests[1].finish())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.error).toBeNull()
  } finally {
    hook.unmount()
  }
})
