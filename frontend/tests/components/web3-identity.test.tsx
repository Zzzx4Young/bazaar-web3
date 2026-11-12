import { beforeEach, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { WalletSignIn } from '@/components/web3/wallet-sign-in'
import { WalletReauthCompletion } from '@/components/web3/wallet-reauth-completion'
import { walletContinuationKey } from '@/lib/web3/identity-client'
import { useAuthStore } from '@/stores/use-auth-store'
import zh from '@/../messages/zh-CN.json'
vi.unmock('next-intl')
const m = vi.hoisted(() => ({
  post: vi.fn(),
  privatePost: vi.fn(),
  replace: vi.fn(),
  events: [] as string[]
}))
vi.mock('@/lib/backend-api', async (original) => ({
  ...(await original<typeof import('@/lib/backend-api')>()),
  getTestnetConfig: vi.fn(async () => ({ enabled: true, chainId: 11155111 })),
  backendPost: m.post
}))
vi.mock('@/lib/authenticated-api', () => ({ authenticatedPost: m.privatePost }))
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({
    replace: (v: string) => {
      m.events.push('redirect')
      m.replace(v)
    }
  })
}))
const a = '0x' + '11'.repeat(20)
const view = {
  account: {
    id: 'account',
    loginName: 'buyer',
    displayName: 'Buyer',
    role: 'participant' as const
  },
  csrfToken: 'new-session'
}
const wrap = (c: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zh}>
      {c}
    </NextIntlClientProvider>
  )
beforeEach(() => {
  vi.clearAllMocks()
  m.events.length = 0
  sessionStorage.clear()
  useAuthStore.setState({ status: 'anonymous', view: null })
  Object.defineProperty(window, 'ethereum', {
    configurable: true,
    value: {
      request: vi.fn(async ({ method }: { method: string }) =>
        method === 'eth_chainId'
          ? '0xaa36a7'
          : method === 'eth_getCode'
            ? '0x'
            : method === 'personal_sign' || method === 'eth_signTypedData_v4'
              ? '0x' + '11'.repeat(65)
              : [a]
      )
    }
  })
})
it('SIWE success accepts server session, closes modal then uses the safe return destination', async () => {
  m.post.mockImplementation(async (path: string) =>
    path.endsWith('/challenge')
      ? {
          id: 'challenge',
          message: 'Server SIWE',
          expiresAt: new Date(Date.now() + 300000).toISOString()
        }
      : view
  )
  wrap(
    <WalletSignIn returnTo="/en/orders?page=2#result" onSuccess={() => m.events.push('close')} />
  )
  await userEvent.click(await screen.findByRole('button', { name: '使用已绑定钱包登录' }))
  await waitFor(() => expect(useAuthStore.getState().view?.csrfToken).toBe('new-session'))
  expect(m.replace).toHaveBeenCalledWith('/orders?page=2#result')
  expect(m.events).toEqual(['close', 'redirect'])
})
it('SIWE failure never accepts a session or closes the dialog', async () => {
  m.post.mockRejectedValue(new Error('INVALID_CREDENTIALS'))
  const success = vi.fn()
  wrap(<WalletSignIn onSuccess={success} />)
  await userEvent.click(await screen.findByRole('button', { name: '使用已绑定钱包登录' }))
  await screen.findByRole('alert')
  expect(success).not.toHaveBeenCalled()
  expect(useAuthStore.getState().view).toBeNull()
})
it('Google continuation for another account cannot create a wallet challenge', async () => {
  useAuthStore.setState({ status: 'authenticated', view })
  sessionStorage.setItem(
    walletContinuationKey,
    JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111',
      key: '22222222-2222-4222-8222-222222222222',
      accountId: 'different',
      purpose: 'bind',
      address: a,
      chainId: 11155111,
      expiresAt: new Date(Date.now() + 300000).toISOString()
    })
  )
  wrap(<WalletReauthCompletion />)
  await screen.findByRole('alert')
  expect(m.privatePost).not.toHaveBeenCalled()
})
