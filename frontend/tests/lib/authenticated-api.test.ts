import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authenticatedPost } from '@/lib/authenticated-api'
import { backendRequest, BackendError } from '@/lib/backend-api'
import { useAuthStore } from '@/stores/use-auth-store'

vi.mock('@/lib/backend-api', async (original) => ({
  ...(await original<typeof import('@/lib/backend-api')>()),
  backendRequest: vi.fn()
}))

function signIn(id: string) {
  useAuthStore.setState({
    status: 'authenticated',
    view: {
      account: { id, loginName: id, displayName: id, role: 'participant' },
      csrfToken: `csrf-${id}`
    }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  signIn('buyer-1')
})
afterEach(() => vi.restoreAllMocks())

it('does not redirect a new session when a previous session receives a late unauthorized response', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  let fail!: (reason: Error) => void
  vi.mocked(backendRequest).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  const request = authenticatedPost('/orders/order-1/actions/pay', {}, 'original-key')
  const rejected = expect(request).rejects.toMatchObject({ status: 401 })
  signIn('buyer-2')
  fail(new BackendError('UNAUTHENTICATED', 401))
  await rejected
  expect(useAuthStore.getState().view?.account.id).toBe('buyer-2')
  expect(replace).not.toHaveBeenCalled()
})

it('invalidates and redirects the same session on an unauthorized response', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  vi.mocked(backendRequest).mockRejectedValueOnce(new BackendError('UNAUTHENTICATED', 401))
  await expect(authenticatedPost('/orders/order-1/actions/pay', {})).rejects.toMatchObject({
    status: 401
  })
  expect(useAuthStore.getState().view).toBeNull()
  expect(replace).toHaveBeenCalledOnce()
})

it('forwards cancellation for private reads without redirecting on a canceled connection', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  const controller = new AbortController()
  vi.mocked(backendRequest).mockImplementationOnce((_path, init) => {
    expect(init?.signal).toBe(controller.signal)
    return new Promise((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new BackendError('NETWORK_ERROR', 0)),
        { once: true }
      )
    })
  })
  const pending = authenticatedPost('/orders/example', {}, undefined, controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ status: 0 })
  controller.abort()
  await rejected
  expect(useAuthStore.getState().view?.account.id).toBe('buyer-1')
  expect(replace).not.toHaveBeenCalled()
})
