import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IdentitySettings } from '@/components/me/identity-settings'
import { useAuthStore } from '@/stores/use-auth-store'

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', error: null, view: {
    account: { id: 'account-1', loginName: 'old@gmail.com', displayName: 'Old', role: 'participant' },
    csrfToken: 'test-csrf'
  } })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
    ok: true, status: 200, headers: new Headers(),
    json: async () => url.includes('/auth/methods')
      ? { password: true, google: true, emailCode: false }
      : { google: false, email: false, hasPassword: true }
  })))
})
afterEach(() => vi.unstubAllGlobals())

it('requires a password before a password account can start Google binding', async () => {
  render(<IdentitySettings />)
  expect(await screen.findByRole('button', { name: 'linkGoogle' })).toBeDisabled()
  expect(screen.getByLabelText('confirmPassword')).toBeInTheDocument()
})

it('binds a Gmail address with session, CSRF and code in local development', async () => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true, status: url.endsWith('/auth/email/bind/request') ? 202 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true, emailBindPasswordRequired: false }
      : url.endsWith('/auth/identities')
        ? { google: false, email: false, hasPassword: true }
        : url.endsWith('/auth/email/bind/verify')
          ? { account: useAuthStore.getState().view?.account, csrfToken: 'rotated-csrf' }
          : { accepted: true }
  }))
  vi.stubGlobal('fetch', fetchMock)
  render(<IdentitySettings />)
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: '  New.User+Shop@GMAIL.COM  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/bind/request',
    expect.objectContaining({ body: JSON.stringify({
      email: 'new.user+shop@gmail.com', locale: 'zh-CN'
    }), headers: expect.objectContaining({ 'X-CSRF-Token': 'test-csrf' }) })))
  fireEvent.change(await screen.findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/bind/verify',
    expect.objectContaining({ body: JSON.stringify({
      email: 'new.user+shop@gmail.com', code: '123456'
    }), headers: expect.objectContaining({ 'X-CSRF-Token': 'test-csrf' }) })))
  expect(await screen.findByText('emailLinked')).toBeInTheDocument()
  expect(useAuthStore.getState().view?.csrfToken).toBe('rotated-csrf')
})

it('keeps the binding form open and explains an incorrect code', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
    ok: !url.endsWith('/auth/email/bind/verify'),
    status: url.endsWith('/auth/email/bind/verify') ? 401
      : url.endsWith('/auth/email/bind/request') ? 202 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true, emailBindPasswordRequired: false }
      : url.endsWith('/auth/identities')
        ? { google: false, email: false, hasPassword: true }
        : url.endsWith('/auth/email/bind/verify')
          ? { code: 'INVALID_CREDENTIALS' } : { accepted: true }
  })))
  render(<IdentitySettings />)
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'new@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await screen.findByLabelText('verificationCode'),
    { target: { value: '000000' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyEmailCode' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('账号或验证码不正确')
  expect(screen.getByLabelText('verificationCode')).toBeInTheDocument()
  expect(useAuthStore.getState().view?.csrfToken).toBe('test-csrf')
})
