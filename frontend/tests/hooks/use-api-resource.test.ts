import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useApiResource } from '@/hooks/use-api-resource'
import { backendPost } from '@/lib/backend-api'
import { useAuthStore } from '@/stores/use-auth-store'
import { authenticatedPost } from '@/lib/authenticated-api'

vi.mock('@/lib/authenticated-api', () => ({ authenticatedPost: vi.fn() }))

vi.mock('@/lib/backend-api', async (original) => ({
  ...(await original<typeof import('@/lib/backend-api')>()),
  backendPost: vi.fn()
}))

beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({ view: null, status: 'anonymous' })
})

function pendingRead() {
  let finish!: (data: { version: number }) => void
  const promise = new Promise<{ version: number }>((resolve) => {
    finish = resolve
  })
  return { promise, finish }
}

it('coalesces active reloads into one follow-up read instead of overlapping requests', async () => {
  const first = pendingRead()
  const second = pendingRead()
  vi.mocked(backendPost).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const hook = renderHook(() => useApiResource<{ version: number }>('/listings/example'))
  act(() => {
    hook.result.current.reload()
    hook.result.current.reload()
  })
  expect(backendPost).toHaveBeenCalledTimes(1)
  await act(async () => first.finish({ version: 1 }))
  await waitFor(() => expect(backendPost).toHaveBeenCalledTimes(2))
  await act(async () => second.finish({ version: 2 }))
  expect(hook.result.current.data).toEqual({ version: 2 })
  expect(hook.result.current.refreshing).toBe(false)
})

it('skips polling during a slow read without scheduling a catch-up burst', async () => {
  const first = pendingRead()
  vi.mocked(backendPost).mockReturnValueOnce(first.promise)
  const hook = renderHook(() => useApiResource<{ version: number }>('/listings/example'))
  act(() => {
    hook.result.current.poll()
    hook.result.current.poll()
  })
  expect(backendPost).toHaveBeenCalledTimes(1)
  await act(async () => first.finish({ version: 1 }))
  expect(backendPost).toHaveBeenCalledTimes(1)
})

it('cancels a superseded read and ignores its late result', async () => {
  const first = pendingRead()
  const second = pendingRead()
  vi.mocked(backendPost).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const hook = renderHook(({ path }) => useApiResource<{ version: number }>(path), {
    initialProps: { path: '/listings/first' }
  })
  const signal = vi.mocked(backendPost).mock.calls[0][2]
  hook.rerender({ path: '/listings/second' })
  expect(signal?.aborted).toBe(true)
  await act(async () => second.finish({ version: 2 }))
  await act(async () => first.finish({ version: 1 }))
  expect(hook.result.current.data).toEqual({ version: 2 })
})

it('cancels an unfinished read on unmount', () => {
  vi.mocked(backendPost).mockReturnValueOnce(pendingRead().promise)
  const hook = renderHook(() => useApiResource('/listings/example'))
  const signal = vi.mocked(backendPost).mock.calls[0][2]
  hook.unmount()
  expect(signal?.aborted).toBe(true)
})

it('cancels private reads and their queued reload when the account changes', async () => {
  const login = (id: string) =>
    useAuthStore.setState({
      view: {
        account: { id, loginName: id, displayName: id, role: 'participant' },
        csrfToken: `csrf-${id}`
      },
      status: 'authenticated'
    })
  login('first')
  const first = pendingRead()
  const second = pendingRead()
  vi.mocked(authenticatedPost)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const hook = renderHook(() => useApiResource<{ version: number }>('/orders/example', {}, true))
  const signal = vi.mocked(authenticatedPost).mock.calls[0][3]
  act(() => hook.result.current.reload())
  act(() => login('second'))
  expect(signal?.aborted).toBe(true)
  await act(async () => second.finish({ version: 2 }))
  await act(async () => first.finish({ version: 1 }))
  expect(authenticatedPost).toHaveBeenCalledTimes(2)
  expect(hook.result.current.data).toEqual({ version: 2 })
  act(() => useAuthStore.setState({ view: null, status: 'anonymous' }))
  act(() => {
    hook.result.current.poll()
    hook.result.current.reload()
  })
  expect(authenticatedPost).toHaveBeenCalledTimes(2)
  expect(hook.result.current.data).toBeUndefined()
})

it('does not restart public reads when only the authentication state changes', () => {
  vi.mocked(backendPost).mockReturnValueOnce(pendingRead().promise)
  const hook = renderHook(() => useApiResource('/listings/example'))
  act(() =>
    useAuthStore.setState({
      view: {
        account: { id: 'first', loginName: 'first', displayName: 'First', role: 'participant' },
        csrfToken: 'csrf-first'
      },
      status: 'authenticated'
    })
  )
  expect(backendPost).toHaveBeenCalledTimes(1)
  hook.unmount()
})
