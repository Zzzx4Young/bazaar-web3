import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useLocale } from 'next-intl'
import LoginPage from '@/app/[locale]/login/page'
import RegisterPage from '@/app/[locale]/register/page'
import { TopNav } from '@/components/layout/top-nav'
import { useAuthStore } from '@/stores/use-auth-store'
import zhMessages from '@/../messages/zh-CN.json'

vi.mock('@/components/layout/mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('@/components/layout/favorites-link', () => ({ FavoritesLink: () => null }))
vi.mock('@/components/layout/brand-logo', () => ({ BrandLogo: () => null }))

function emailFetch(verifyOk = true) {
  const account = { id: 'email-account', loginName: 'user@gmail.com',
    displayName: 'user', role: 'participant' }
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/email/verify') || verifyOk,
    status: url.endsWith('/auth/email/request') ? 202
      : url.endsWith('/auth/email/verify') && !verifyOk ? 400 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true }
      : url.endsWith('/auth/email/verify')
        ? verifyOk ? { account, csrfToken: 'verified-csrf' } : { code: 'INVALID_CODE' }
        : { accepted: true }
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.mocked(useLocale).mockReturnValue('zh-CN')
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ password: true, google: true, emailCode: false })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(useLocale).mockReturnValue('zh-CN')
})

it('shows available Google sign-in and explains that email codes are not open', async () => {
  render(<LoginPage />)
  expect(await screen.findByRole('button', { name: 'googleSignIn' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  expect(screen.getByText('emailCodeUnavailable')).toBeInTheDocument()
})

it('starts Google sign-in with the active English locale', async () => {
  vi.mocked(useLocale).mockReturnValue('en')
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true, status: 200, headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: true, emailCode: false }
      : { authorizationUrl: 'https://accounts.google.com/' }
  }))
  vi.stubGlobal('fetch', fetchMock)
  render(<LoginPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'googleSignIn' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/start',
    expect.objectContaining({ body: JSON.stringify({ returnTo: '/en/me' }) })))
})

it('signs in with a Gmail account through the enabled email-code form', async () => {
  const account = { id: 'new-account', loginName: 'browser-check@gmail.com',
    displayName: 'browser-check', role: 'participant' }
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true, status: url.endsWith('/auth/email/request') ? 202 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true }
      : url.endsWith('/auth/email/verify')
        ? { account, csrfToken: 'verified-csrf' } : { accepted: true }
  }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  expect(await screen.findByText('emailCodeLoginTitle')).toBeInTheDocument()
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'browser-check@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/request',
    expect.objectContaining({ body: JSON.stringify({ email: 'browser-check@gmail.com',
      locale: 'zh-CN', intent: 'login' }) })))
  fireEvent.change(await screen.findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/verify',
    expect.objectContaining({ body: JSON.stringify({ email: 'browser-check@gmail.com',
      code: '123456', intent: 'login' }) })))
  await waitFor(() => expect(useAuthStore.getState().view?.account.id).toBe('new-account'))
})

it('registers with a separate email-code intent on the registration page', async () => {
  const fetchMock = emailFetch()
  render(<RegisterPage />)
  expect(await screen.findByText('emailCodeRegisterTitle')).toBeInTheDocument()
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'new.user@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/request',
    expect.objectContaining({ body: JSON.stringify({ email: 'new.user@gmail.com',
      locale: 'zh-CN', intent: 'register' }) })))
  fireEvent.change(await screen.findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/verify',
    expect.objectContaining({ body: JSON.stringify({ email: 'new.user@gmail.com',
      code: '123456', intent: 'register' }) })))
})

it('clears a requested code when the Gmail address changes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
    ok: true, status: url.endsWith('/auth/email/request') ? 202 : 200,
    headers: new Headers(), json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true } : { accepted: true }
  })))
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  const email = await screen.findByLabelText('emailAddress')
  fireEvent.change(email, { target: { value: 'first@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  expect(await screen.findByLabelText('verificationCode')).toBeInTheDocument()
  fireEvent.change(email, { target: { value: 'second@gmail.com' } })
  expect(screen.queryByLabelText('verificationCode')).not.toBeInTheDocument()
})

it('shows a localized rate-limit message beside the code request form', async () => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/email/request'),
    status: url.endsWith('/auth/email/request') ? 429 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true }
      : { code: 'RATE_LIMITED', retryable: true, requestId: 'rate-request' }
  }))
  vi.stubGlobal('fetch', fetchMock)
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'user@gmail.com' } })
  const send = screen.getByRole('button', { name: 'requestEmailCode' })
  fireEvent.click(send)
  expect(await within(send.closest('form')!).findByRole('alert'))
    .toHaveTextContent('emailCodeRateLimited')
  expect(screen.queryByLabelText('verificationCode')).not.toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/request', expect.anything())
})

it('closes the TopNav dialog after email verification succeeds', async () => {
  emailFetch()
  const { container } = render(<><TopNav /><LoginPage /></>)
  fireEvent.click(within(container.querySelector('header')!).getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'emailCodeLogin' }))
  fireEvent.change(await within(dialog).findByLabelText('emailAddress'),
    { target: { value: 'user@gmail.com' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await within(dialog).findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(useAuthStore.getState().view?.account.id).toBe('email-account')
})

it('keeps the TopNav dialog open and shows an error when the code is rejected', async () => {
  emailFetch(false)
  render(<TopNav />)
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'emailCodeLogin' }))
  fireEvent.change(await within(dialog).findByLabelText('emailAddress'),
    { target: { value: 'user@gmail.com' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await within(dialog).findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'verifyEmailCode' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('验证码不正确')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(useAuthStore.getState().status).toBe('anonymous')
})

it('associates labels with unique email and code inputs in page and dialog', async () => {
  emailFetch()
  const { container } = render(<><TopNav /><LoginPage /></>)
  fireEvent.click(within(container.querySelector('header')!).getByRole('button', { name: 'login' }))
  const dialog = screen.getByRole('dialog')
  const page = container.querySelector('section')!
  fireEvent.click(within(page).getByRole('button', { name: 'emailCodeLogin', hidden: true }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'emailCodeLogin' }))
  const pageEmail = await within(page).findByLabelText('emailAddress')
  const dialogEmail = await within(dialog).findByLabelText('emailAddress')
  expect(pageEmail.id).not.toBe(dialogEmail.id)
  fireEvent.change(pageEmail, { target: { value: 'user@gmail.com' } })
  fireEvent.change(dialogEmail, { target: { value: 'user@gmail.com' } })
  fireEvent.click(within(page).getByRole('button', { name: 'requestEmailCode', hidden: true }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'requestEmailCode' }))
  const pageCode = await within(page).findByLabelText('verificationCode')
  const dialogCode = await within(dialog).findByLabelText('verificationCode')
  expect(pageCode.id).not.toBe(dialogCode.id)
  for (const input of [pageEmail, dialogEmail, pageCode, dialogCode]) {
    expect(document.querySelectorAll(`[id="${input.id}"]`)).toHaveLength(1)
    expect(document.querySelector(`label[for="${input.id}"]`)).toBeTruthy()
  }
})

it('rejects non-Gmail addresses before requesting a code', async () => {
  const fetchMock = emailFetch()
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'user@yahoo.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalidGmail')
  expect(zhMessages.nav.invalidGmail).toBe('请输入有效的 Gmail 邮箱地址')
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/email/request'))).toBe(false)
})

it('rejects malformed Gmail aliases before requesting a code', async () => {
  const fetchMock = emailFetch()
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'user+@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalidGmail')
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/auth/email/request'))).toBe(false)
})

it('trims and lowercases a valid Gmail address before requesting a code', async () => {
  const fetchMock = emailFetch()
  render(<LoginPage />)
  fireEvent.click(screen.getByRole('button', { name: 'emailCodeLogin' }))
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: '  User.Name+Tag.More@GMAIL.COM  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/request',
    expect.objectContaining({ body: JSON.stringify({
      email: 'user.name+tag.more@gmail.com', locale: 'zh-CN', intent: 'login'
    }) })))
})
