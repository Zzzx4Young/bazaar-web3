import { afterEach, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCurrencies } from '@/hooks/use-currencies'

afterEach(() => vi.unstubAllGlobals())

it('uses the current server currency catalog, including less common supported currencies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/api/currencies') throw new Error(`Unexpected URL: ${url}`)
      return new Response(
        JSON.stringify([
          { code: 'CNY', scale: 2 },
          { code: 'BRL', scale: 2 },
          { code: 'JPY', scale: 0 }
        ]),
        { status: 200 }
      )
    })
  )

  const { result } = renderHook(() => useCurrencies())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.currencies).toEqual([
    { code: 'CNY', scale: 2 },
    { code: 'BRL', scale: 2 },
    { code: 'JPY', scale: 0 }
  ])
})

it('shows a load failure and can retry without inventing currency options', async () => {
  let attempts = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      attempts += 1
      return attempts === 1
        ? new Response(JSON.stringify({ code: 'UNAVAILABLE' }), { status: 503 })
        : new Response(JSON.stringify([{ code: 'USD', scale: 2 }]), { status: 200 })
    })
  )

  const { result } = renderHook(() => useCurrencies())
  await waitFor(() => expect(result.current.error).not.toBeNull())
  expect(result.current.currencies).toEqual([])
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.currencies).toEqual([{ code: 'USD', scale: 2 }]))
  expect(result.current.error).toBeNull()
})
