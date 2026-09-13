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
      account: { id: 'buyer-1', loginName: 'buyer', displayName: 'Buyer' },
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
