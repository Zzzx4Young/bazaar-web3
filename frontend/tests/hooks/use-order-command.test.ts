import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useOrderCommand } from '@/hooks/use-order-command'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'

vi.mock('@/lib/authenticated-api', () => ({ authenticatedPost: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  useAuthStore.setState({
    status: 'authenticated',
    view: {
      account: { id: 'buyer-1', loginName: 'buyer', displayName: 'Buyer', role: 'participant' },
      csrfToken: 'csrf'
    },
    error: null
  })
})

it('replays the same payload and idempotency key after remounting an unknown result', async () => {
  vi.mocked(authenticatedPost)
    .mockRejectedValueOnce(new Error('NETWORK_ERROR'))
    .mockResolvedValueOnce({ orderId: 'order-1' })
  const first = renderHook(() => useOrderCommand())
  await act(() => first.result.current.run('/orders/order-1/actions/pay', {}))
  const initialCall = vi.mocked(authenticatedPost).mock.calls[0]
  expect(first.result.current.uncertain).toBe(true)
  first.unmount()

  const restored = renderHook(() => useOrderCommand())
  await waitFor(() => expect(restored.result.current.uncertain).toBe(true))
  await act(() => restored.result.current.retry())

  expect(vi.mocked(authenticatedPost).mock.calls[1]).toEqual(initialCall)
  expect(sessionStorage.getItem('bazaar:alpha-pending-command:buyer-1')).toBeNull()
  expect(restored.result.current.uncertain).toBe(false)
})

function switchAccount(id: string) {
  useAuthStore.setState({
    view: {
      account: { id, loginName: id, displayName: id, role: 'participant' },
      csrfToken: `csrf-${id}`
    }
  })
}

it('keeps an unknown command with its owner when another account signs in', async () => {
  vi.mocked(authenticatedPost).mockRejectedValueOnce(new Error('NETWORK_ERROR'))
  const hook = renderHook(() => useOrderCommand())
  await act(() => hook.result.current.run('/orders/order-1/actions/pay', {}))
  const ownerCommand = vi.mocked(authenticatedPost).mock.calls[0]
  act(() => switchAccount('buyer-2'))
  expect(hook.result.current.uncertain).toBe(false)
  await act(() => hook.result.current.retry())
  expect(authenticatedPost).toHaveBeenCalledTimes(1)
  expect(sessionStorage.getItem('bazaar:alpha-pending-command:buyer-1')).not.toBeNull()
  act(() => switchAccount('buyer-1'))
  vi.mocked(authenticatedPost).mockResolvedValueOnce({ orderId: 'order-1' })
  await act(() => hook.result.current.retry())
  expect(vi.mocked(authenticatedPost).mock.calls[1]).toEqual(ownerCommand)
})

it('ignores an old account completion while the current account has a request in flight', async () => {
  let finishFirst!: (value: { orderId: string }) => void
  let finishSecond!: (value: { orderId: string }) => void
  vi.mocked(authenticatedPost)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve
        })
    )
  const hook = renderHook(() => useOrderCommand())
  let first!: Promise<object | undefined>
  act(() => {
    first = hook.result.current.run('/orders/order-1/actions/pay', {})
  })
  act(() => switchAccount('buyer-2'))
  let second!: Promise<object | undefined>
  act(() => {
    second = hook.result.current.run('/orders/order-2/actions/pay', {})
  })
  expect(authenticatedPost).toHaveBeenCalledTimes(2)
  await act(async () => {
    finishFirst({ orderId: 'order-1' })
    expect(await first).toBeUndefined()
  })
  expect(hook.result.current.busy).toBe(true)
  expect(sessionStorage.getItem('bazaar:alpha-pending-command:buyer-2')).not.toBeNull()
  await act(async () => {
    finishSecond({ orderId: 'order-2' })
    await second
  })
  expect(hook.result.current.busy).toBe(false)
})

it('does not treat a storage cleanup failure as an unknown committed result', async () => {
  vi.mocked(authenticatedPost).mockResolvedValueOnce({ orderId: 'order-1' })
  const hook = renderHook(() => useOrderCommand())
  const remove = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  try {
    await act(async () => {
      expect(await hook.result.current.run('/orders/order-1/actions/pay', {})).toEqual({
        orderId: 'order-1'
      })
    })
    expect(hook.result.current.uncertain).toBe(false)
    expect(hook.result.current.error).toBeUndefined()
  } finally {
    remove.mockRestore()
  }
})

it('discards malformed saved commands instead of sending them', async () => {
  sessionStorage.setItem(
    'bazaar:alpha-pending-command:buyer-1',
    JSON.stringify({ path: '/orders/x' })
  )
  const hook = renderHook(() => useOrderCommand())
  await act(() => hook.result.current.retry())
  expect(authenticatedPost).not.toHaveBeenCalled()
  expect(hook.result.current.uncertain).toBe(false)
})

it('ignores a completion from an earlier login even after switching back to the same account', async () => {
  let finish!: (value: { orderId: string }) => void
  vi.mocked(authenticatedPost).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const hook = renderHook(() => useOrderCommand())
  let first!: Promise<object | undefined>
  act(() => {
    first = hook.result.current.run('/orders/order-1/actions/pay', {})
  })
  act(() => {
    switchAccount('buyer-2')
    switchAccount('buyer-1')
  })
  await act(async () => {
    finish({ orderId: 'order-1' })
    expect(await first).toBeUndefined()
  })
  expect(hook.result.current.uncertain).toBe(true)
  expect(sessionStorage.getItem('bazaar:alpha-pending-command:buyer-1')).not.toBeNull()
})

it('does not let a retained callback issue a command under a different account', async () => {
  const hook = renderHook(() => useOrderCommand())
  const oldRun = hook.result.current.run
  act(() => switchAccount('buyer-2'))
  await act(() => oldRun('/orders/order-1/actions/pay', {}))
  expect(authenticatedPost).not.toHaveBeenCalled()
})

it('keeps the new account state after an old request fails or the user signs out', async () => {
  let fail!: (reason: Error) => void
  vi.mocked(authenticatedPost).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  const hook = renderHook(() => useOrderCommand())
  let first!: Promise<object | undefined>
  act(() => {
    first = hook.result.current.run('/orders/order-1/actions/pay', {})
  })
  act(() => useAuthStore.setState({ view: null, status: 'anonymous' }))
  await act(async () => {
    fail(new Error('NETWORK_ERROR'))
    await first
  })
  expect(hook.result.current.error).toBeUndefined()
  expect(hook.result.current.uncertain).toBe(false)
  await act(() => hook.result.current.retry())
  expect(authenticatedPost).toHaveBeenCalledTimes(1)
})
