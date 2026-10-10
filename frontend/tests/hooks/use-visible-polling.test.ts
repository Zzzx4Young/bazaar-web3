import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useVisiblePolling } from '@/hooks/use-visible-polling'
import { orderRefreshIntervalMs } from '@/lib/refresh-policy'

let visibility: DocumentVisibilityState
beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('polls at the policy interval and removes timers and listeners on unmount', () => {
  const poll = vi.fn()
  const hook = renderHook(() => useVisiblePolling(poll, true, orderRefreshIntervalMs))
  act(() => vi.advanceTimersByTime(orderRefreshIntervalMs - 1))
  expect(poll).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(poll).toHaveBeenCalledTimes(1)
  hook.unmount()
  act(() => {
    vi.advanceTimersByTime(orderRefreshIntervalMs)
    window.dispatchEvent(new Event('focus'))
  })
  expect(poll).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('stops while hidden and refreshes immediately on returning to the page', () => {
  const poll = vi.fn()
  const hook = renderHook(() => useVisiblePolling(poll, true, orderRefreshIntervalMs))
  act(() => {
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  act(() => {
    vi.advanceTimersByTime(orderRefreshIntervalMs * 3)
    window.dispatchEvent(new Event('focus'))
  })
  expect(poll).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  act(() => {
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(poll).toHaveBeenCalledTimes(1)
  act(() => vi.advanceTimersByTime(orderRefreshIntervalMs))
  expect(poll).toHaveBeenCalledTimes(2)
  hook.unmount()
})

it('does not poll without an authenticated reader and stops when it becomes disabled', () => {
  const poll = vi.fn()
  const hook = renderHook(
    ({ enabled }) => useVisiblePolling(poll, enabled, orderRefreshIntervalMs),
    {
      initialProps: { enabled: false }
    }
  )
  act(() => {
    vi.advanceTimersByTime(orderRefreshIntervalMs)
    window.dispatchEvent(new Event('focus'))
  })
  expect(poll).not.toHaveBeenCalled()
  hook.rerender({ enabled: true })
  act(() => vi.advanceTimersByTime(orderRefreshIntervalMs))
  expect(poll).toHaveBeenCalledTimes(1)
  hook.rerender({ enabled: false })
  act(() => vi.advanceTimersByTime(orderRefreshIntervalMs * 3))
  expect(poll).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  hook.unmount()
})
