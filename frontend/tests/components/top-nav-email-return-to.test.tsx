import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TopNav } from '@/components/layout/top-nav'
import { useAuthStore } from '@/stores/use-auth-store'

const replace = vi.hoisted(() => vi.fn())
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  usePathname: () => '/',
  useRouter: () => ({ replace })
}))
vi.mock('@/components/layout/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/layout/favorites-link', () => ({ FavoritesLink: () => null }))
vi.mock('@/components/layout/brand-logo', () => ({ BrandLogo: () => null }))

function emailFetch(verifyOk = true) {
  const mock = vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/email/verify') || verifyOk,
    status: url.endsWith('/auth/email/verify') && !verifyOk ? 401
      : url.endsWith('/auth/email/request') ? 202 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true }
      : url.endsWith('/auth/email/verify')
        ? verifyOk ? { account: { id: 'buyer', loginName: 'buyer@gmail.com',
          displayName: 'Buyer', role: 'participant' }, csrfToken: 'csrf' }
          : { code: 'INVALID_CODE' }
        : { accepted: true }
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

beforeEach(() => {
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
  replace.mockReset()
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
})

async function verifyInNav(currentUrl: string) {
  window.history.replaceState({}, '', currentUrl)
  emailFetch()
  render(<TopNav />)
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(await within(dialog).findByLabelText('emailAddress'),
    { target: { value: 'buyer@gmail.com' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await within(dialog).findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(replace).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useAuthStore.getState().status).toBe('authenticated')
  return replace.mock.lastCall?.[0]
}

it.each([
  ['/products', '/products'],
  ['/products?category=art&page=2', '/products?category=art&page=2'],
  ['/products?sort=price#results', '/products?sort=price#results'],
  ['/login?returnTo=%2Fdashboard', '/dashboard'],
  ['/en/login?returnTo=%2Forders%3Fpage%3D2', '/orders?page=2'],
  ['/login?returnTo=%2Fproducts%3Fq%3Dhello%2520world%26page%3D2',
    '/products?q=hello%20world&page=2'],
  ['/zh-CN/login?returnTo=%2Fdashboard%23results', '/dashboard#results'],
  ['/login?returnTo=%2Fenterprise', '/enterprise'],
  ['/login', '/me'],
  ['/login?returnTo=https://evil.com', '/me'],
  ['/login?returnTo=%2F%2Fevil.com', '/me'],
  ['/en/login?returnTo=%2Fen%2F%2Fevil.com', '/me'],
  ['/login?returnTo=%2Flogin%3FreturnTo%3D%2Fdashboard', '/me'],
  ['/login?returnTo=%2Flogin%2F', '/me']
])('nav email login from %j redirects to %j', async (currentUrl, expected) => {
  expect(await verifyInNav(currentUrl)).toBe(expected)
})

it('keeps the dialog open after a rejected email code', async () => {
  window.history.replaceState({}, '', '/products?sort=price#results')
  emailFetch(false)
  render(<TopNav />)
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(await within(dialog).findByLabelText('emailAddress'),
    { target: { value: 'buyer@gmail.com' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await within(dialog).findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'verifyEmailCode' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('验证码不正确')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})

it('keeps the existing pathname-only Google start payload', async () => {
  window.history.replaceState({}, '', '/products?sort=price#results')
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/google/start'),
    status: url.endsWith('/auth/google/start') ? 503 : 200,
    headers: new Headers(), json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: true, emailCode: true } : { code: 'GOOGLE_UNAVAILABLE' }
  }))
  vi.stubGlobal('fetch', fetchMock)
  render(<TopNav />)
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(await within(dialog).findByRole('button', { name: 'googleSignIn' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/start',
    expect.objectContaining({ body: JSON.stringify({ returnTo: '/products' }) })))
})
