import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLocale } from 'next-intl'
import LoginPage from '@/app/[locale]/login/page'

beforeEach(() => {
  vi.mocked(useLocale).mockReturnValue('zh-CN')
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
