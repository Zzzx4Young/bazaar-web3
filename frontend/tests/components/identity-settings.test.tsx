import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
