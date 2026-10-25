import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TopNav } from '@/components/layout/top-nav'
import RegisterPage from '@/app/[locale]/register/page'
import LoginPage from '@/app/[locale]/login/page'
import { useAuthStore } from '@/stores/use-auth-store'
import zhMessages from '@/../messages/zh-CN.json'
import enMessages from '@/../messages/en.json'
import { useLocale } from 'next-intl'
import { renderToString } from 'react-dom/server'

const replace = vi.hoisted(() => vi.fn())
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
  usePathname: () => '/',
  useRouter: () => ({ replace })
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ replace }),
  usePathname: () => window.location.pathname,
  notFound: vi.fn()
}))

vi.mock('@/components/layout/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/layout/favorites-link', () => ({ FavoritesLink: () => null }))
vi.mock('@/components/layout/brand-logo', () => ({ BrandLogo: () => null }))

function methods(google: boolean, emailCode: boolean) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ password: true, google, emailCode })
  }))
}

beforeEach(() => {
  vi.mocked(useLocale).mockReturnValue('zh-CN')
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
  methods(false, false)
  replace.mockReset()
})
afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
})

it('exposes registration from the header, login dialog, and login page', async () => {
  render(<><TopNav /><LoginPage /></>)
  expect(within(screen.getByRole('banner')).getByRole('link', { name: 'register' }))
    .toHaveAttribute('href', '/register')
  expect(within(document.querySelector('section')!).getByRole('link', { name: 'register' }))
    .toHaveAttribute('href', '/register')
  await screen.findByText('googleUnavailable')
  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('link', { name: 'register' }))
    .toHaveAttribute('href', '/register?returnTo=%2F')
  await within(dialog).findByText('googleUnavailable')
})

it('renders a stable header sign-up link before client location is available', () => {
  window.history.replaceState({}, '', '/zh-CN/login?returnTo=%2Forders')
  const markup = renderToString(<TopNav />)
  expect(markup).toContain('href="/register"')
  expect(markup).not.toContain('href="/register?returnTo=')
})

it('updates the header sign-up target when only the login query changes', () => {
  window.history.replaceState({}, '', '/zh-CN/login?returnTo=%2Forders')
  const view = render(<TopNav />)
  const headerLink = () => within(screen.getByRole('banner')).getByRole('link', { name: 'register' })
  expect(headerLink()).toHaveAttribute('href', '/register?returnTo=%2Forders')
  window.history.replaceState({}, '', '/zh-CN/login?returnTo=%2Fcart')
  view.rerender(<TopNav />)
  expect(headerLink()).toHaveAttribute('href', '/register?returnTo=%2Fcart')
})

it('shows an honest registration page while both providers are unavailable', async () => {
  render(<RegisterPage />)
  expect(screen.getByRole('heading', { name: 'register' })).toBeInTheDocument()
  expect(await screen.findByText('googleUnavailable')).toBeInTheDocument()
  expect(screen.getByText('emailCodeUnavailable')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'googleSignIn' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'login' })).toHaveAttribute('href', '/login')
  expect(zhMessages.nav.register).toBe('注册')
  expect(enMessages.nav.register).toBe('Sign up')
})

it('offers the existing registration methods when the backend enables them', async () => {
  methods(true, true)
  render(<RegisterPage />)
  expect(await screen.findByRole('button', { name: 'googleSignIn' })).toBeEnabled()
  expect(screen.getByLabelText('emailAddress')).toBeInTheDocument()
})

it.each([
  ['/zh-CN/login?returnTo=%2Forders%3Fpage%3D2%23items',
    '/register?returnTo=%2Forders%3Fpage%3D2%23items'],
  ['/en/login?returnTo=%2Fen%2Forders%3Fpage%3D2',
    '/register?returnTo=%2Forders%3Fpage%3D2'],
  ['/zh-CN/login?returnTo=%2F%2Fevil.example', '/register?returnTo=%2Fme']
])('login registration links retain only a safe return target from %s', async (url, href) => {
  window.history.replaceState({}, '', url)
  render(<><TopNav /><LoginPage /></>)
  expect(within(screen.getByRole('banner')).getByRole('link', { name: 'register' }))
    .toHaveAttribute('href', href)
  expect(within(document.querySelector('section')!).getByRole('link', { name: 'register' }))
    .toHaveAttribute('href', href)
  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'login' }))
  expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'register' }))
    .toHaveAttribute('href', href)
})

it.each([
  ['/zh-CN/register?returnTo=%2Forders%3Fpage%3D2%23items',
    '/login?returnTo=%2Forders%3Fpage%3D2%23items'],
  ['/en/register?returnTo=%2Fen%2Forders%3Fpage%3D2',
    '/login?returnTo=%2Forders%3Fpage%3D2'],
  ['/zh-CN/register?returnTo=https%3A%2F%2Fevil.example',
    '/login?returnTo=%2Fme']
])('registration sign-in link retains only a safe return target from %s', (url, href) => {
  window.history.replaceState({}, '', url)
  render(<RegisterPage />)
  expect(screen.getByRole('link', { name: 'login' })).toHaveAttribute('href', href)
})

it('keeps the current URL through the nav dialog registration link', () => {
  window.history.replaceState({}, '', '/zh-CN/products?sort=price#results')
  render(<TopNav />)
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'register' }))
    .toHaveAttribute('href', '/register?returnTo=%2Fproducts%3Fsort%3Dprice%23results')
})

it('returns to the protected action after email-code registration', async () => {
  window.history.replaceState({}, '', '/zh-CN/register?returnTo=%2Forders%3Fpage%3D2')
  methods(false, true)
  render(<RegisterPage />)
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'new@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await screen.findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/orders?page=2'))
})

it('falls back to the profile for an unsafe registration return target', async () => {
  window.history.replaceState({}, '', '/zh-CN/register?returnTo=%2F%2Fevil.example')
  methods(false, true)
  render(<RegisterPage />)
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'new@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await screen.findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/me'))
})

it('sends the same safe locale path to Google on registration', async () => {
  window.history.replaceState({}, '', '/en/register?returnTo=%2Fen%2Forders%3Fpage%3D2')
  vi.mocked(useLocale).mockReturnValue('en')
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/google/start'),
    status: url.endsWith('/auth/google/start') ? 503 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: true, emailCode: false }
      : { code: 'GOOGLE_UNAVAILABLE' }
  }))
  vi.stubGlobal('fetch', fetchMock)
  render(<RegisterPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'googleSignIn' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/start',
    expect.objectContaining({ body: JSON.stringify({ returnTo: '/en/orders?page=2' }) })))
})

it('keeps a plus sign in a safe search query for Google registration', async () => {
  window.history.replaceState({}, '', '/en/register?returnTo=%2Fen%2Fexplore%3Fq%3Dfoo%2Bbar')
  vi.mocked(useLocale).mockReturnValue('en')
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/google/start'),
    status: url.endsWith('/auth/google/start') ? 503 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: true, emailCode: false }
      : { code: 'GOOGLE_UNAVAILABLE' }
  }))
  vi.stubGlobal('fetch', fetchMock)
  render(<RegisterPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'googleSignIn' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/start',
    expect.objectContaining({ body: JSON.stringify({ returnTo: '/en/explore?q=foo+bar' }) })))
})
