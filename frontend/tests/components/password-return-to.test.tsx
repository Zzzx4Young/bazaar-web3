import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoginPage from '@/app/[locale]/login/page'
import { useAuthStore } from '@/stores/use-auth-store'

const replace = vi.hoisted(() => vi.fn())
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ replace }) }))

beforeEach(() => {
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
    ok: true, status: 200, headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: false }
      : { account: { id: 'buyer', loginName: 'buyer',
        displayName: 'Buyer', role: 'participant' }, csrfToken: 'csrf' }
  })))
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
  replace.mockReset()
})

async function signIn(returnTo?: string) {
  const query = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`
  window.history.replaceState({}, '', `/zh-CN/login${query}`)
  render(<LoginPage />)
  fireEvent.change(screen.getByLabelText('loginName'), { target: { value: 'buyer' } })
  fireEvent.change(screen.getByLabelText('password'), { target: { value: 'password' } })
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  await waitFor(() => expect(replace).toHaveBeenCalledOnce())
  return replace.mock.lastCall?.[0]
}

it.each([
  [undefined, '/'],
  ['/dashboard', '/dashboard'],
  ['/en/dashboard?tab=profile#details', '/dashboard?tab=profile#details'],
  ['/zh-CN/me', '/me'],
  ['/enterprise', '/enterprise'],
  ['/en//example.com', '/'],
  ['//example.com', '/'],
  ['https://example.com', '/'],
  ['javascript:alert(1)', '/'],
  ['/en/\\example.com', '/'],
  ['/en/%2F%2Fexample.com', '/'],
  ['/en/%252F%252Fexample.com', '/'],
  ['/en/%2e%2e//example.com', '/'],
  ['/en/dashboard\n', '/'],
  ['', '/']
])('password login sends %j only to safe destination %j', async (returnTo, expected) => {
  expect(await signIn(returnTo)).toBe(expected)
})

it('does not redirect when password authentication fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/login'), status: url.endsWith('/auth/login') ? 401 : 200,
    headers: new Headers(), json: async () => url.endsWith('/auth/login')
      ? { code: 'INVALID_CREDENTIALS' }
      : { password: true, google: false, emailCode: false }
  })))
  window.history.replaceState({}, '', '/zh-CN/login?returnTo=%2F%2Fevil.example')
  render(<LoginPage />)
  fireEvent.change(screen.getByLabelText('loginName'), { target: { value: 'buyer' } })
  fireEvent.change(screen.getByLabelText('password'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('INVALID_CREDENTIALS')
  expect(replace).not.toHaveBeenCalled()
})
