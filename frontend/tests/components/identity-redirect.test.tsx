import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IdentityOptions } from '@/components/auth/identity-options'
import { useAuthStore } from '@/stores/use-auth-store'

const replace = vi.hoisted(() => vi.fn())
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ replace }) }))

afterEach(() => {
  vi.unstubAllGlobals()
  replace.mockReset()
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
})

async function verifyEmail(returnTo?: string) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({
    ok: true, status: url.endsWith('/auth/email/request') ? 202 : 200,
    headers: new Headers(),
    json: async () => url.endsWith('/auth/methods')
      ? { password: true, google: false, emailCode: true }
      : url.endsWith('/auth/email/verify')
        ? { account: { id: 'buyer', loginName: 'user@gmail.com',
          displayName: 'buyer', role: 'participant' }, csrfToken: 'csrf' }
        : { accepted: true }
  })))
  render(<IdentityOptions returnTo={returnTo} />)
  fireEvent.change(await screen.findByLabelText('emailAddress'),
    { target: { value: 'user@gmail.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'requestEmailCode' }))
  fireEvent.change(await screen.findByLabelText('verificationCode'),
    { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'verifyEmailCode' }))
  await waitFor(() => expect(replace).toHaveBeenCalledOnce())
  return replace.mock.lastCall?.[0]
}

it.each([
  ['/dashboard', '/dashboard'],
  ['/en/dashboard', '/dashboard'],
  ['/zh-CN/dashboard?tab=profile#details', '/dashboard?tab=profile#details'],
  ['/zh/dashboard?tab=profile', '/zh/dashboard?tab=profile'],
  ['/enterprise', '/enterprise'],
  ['/en', '/'],
  ['/en//example.com', '/me'],
  ['//example.com', '/me'],
  ['https://example.com', '/me'],
  ['/en/\\example.com', '/me'],
  ['/en/%2F%2Fexample.com', '/me'],
  ['/en/%5cexample.com', '/me'],
  ['/en/%252f%252fexample.com', '/me'],
  ['/en/%2e%2e//example.com', '/me'],
  ['/en/%0aexample.com', '/me'],
  ['/en/../dashboard', '/me'],
  ['/en/en/dashboard', '/me'],
  ['/en/dashboard\u000a', '/me'],
  ['', '/me'],
  ['dashboard', '/me']
])('navigates safely from %j to %j', async (returnTo, expected) => {
  expect(await verifyEmail(returnTo)).toBe(expected)
})

it('uses the profile fallback when no returnTo is supplied', async () => {
  expect(await verifyEmail()).toBe('/me')
})
