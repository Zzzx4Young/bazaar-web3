import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login, logout, refreshSession, type AuthView } from '@/lib/backend-api'
import { useAuthStore } from '@/stores/use-auth-store'

vi.mock('@/lib/backend-api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  backendErrorCode: (error: Error) => error.message,
  backendErrorMessage: (error: Error & { requestId?: string }) =>
    error.requestId ? `${error.message} · Request ID: ${error.requestId}` : error.message
}))

const view: AuthView = {
  account: { id: 'buyer', loginName: 'buyer', displayName: 'Buyer' },
  csrfToken: 'test'
}

beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({ status: 'loading', view: null, error: null })
})

describe('backend session boundaries', () => {
  it('deduplicates restoration and does not overwrite a newer login', async () => {
    let resolve!: (value: AuthView) => void
    vi.mocked(refreshSession).mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const first = useAuthStore.getState().restore()
    const second = useAuthStore.getState().restore()
    expect(refreshSession).toHaveBeenCalledTimes(1)
    vi.mocked(login).mockResolvedValue(view)
    await useAuthStore.getState().signIn('buyer', 'password')
    resolve({ ...view, account: { ...view.account, id: 'old-account' } })
    await Promise.all([first, second])
    expect(useAuthStore.getState().view).toEqual(view)
  })

  it('keeps the session and reports failed logout, then permits retry', async () => {
    useAuthStore.setState({ status: 'authenticated', view })
    vi.mocked(logout).mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValueOnce()
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      view,
      error: 'NETWORK_ERROR'
    })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState()).toMatchObject({ status: 'anonymous', view: null, error: null })
  })

  it('clears an expired session on logout', async () => {
    useAuthStore.setState({ status: 'authenticated', view })
    vi.mocked(logout).mockRejectedValue(new Error('UNAUTHENTICATED'))
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().view).toBeNull()
  })

  it('distinguishes an unavailable service from an anonymous session', async () => {
    vi.mocked(refreshSession)
      .mockRejectedValueOnce(new Error('NETWORK_ERROR'))
      .mockRejectedValueOnce(new Error('UNAUTHENTICATED'))
    await useAuthStore.getState().restore()
    expect(useAuthStore.getState().status).toBe('unavailable')
    await useAuthStore.getState().restore()
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('keeps the request ID in a tester-visible authentication error', async () => {
    const failure = Object.assign(new Error('UNAVAILABLE'), { requestId: 'request-123' })
    vi.mocked(login).mockRejectedValue(failure)
    await useAuthStore.getState().signIn('buyer', 'password')
    expect(useAuthStore.getState().error).toBe('UNAVAILABLE · Request ID: request-123')
  })
})
