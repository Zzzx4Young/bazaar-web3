import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { TestnetBuy } from '@/components/web3/testnet-buy'
import { useAuthStore } from '@/stores/use-auth-store'
import type { Item } from '@/types'
import zh from '@/../messages/zh-CN.json'
vi.unmock('next-intl')
const item: Item = {
  id: 'listing', backendVersion: 2, sellerId: 'seller', title: 'File', description: 'File',
  category: 'digital', tags: [], price: { amount: 1, currency: 'USD' }, media: [],
  status: 'active', purchaseEligible: true, createdAt: '', updatedAt: '',
  testnetPrice: { amount: '1.25', amountAtoms: '1250000', currency: 'BZTEST', decimals: 6,
    chainId: 11155111, token: '0x' + '1'.repeat(40), escrow: '0x' + '2'.repeat(40) }
}
beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', view: { csrfToken: 'session',
    account: { id: 'buyer', loginName: 'buyer', displayName: 'Buyer', role: 'participant' } } })
})
it.each([undefined, false, null, 'true', 1])('pauses new orders for unknown or invalid payout eligibility %s', (value) => {
  render(<NextIntlClientProvider locale="zh-CN" messages={zh}>
    <TestnetBuy item={{ ...item, testnetPurchaseEligible: value } as Item} />
  </NextIntlClientProvider>)
  expect(screen.getByRole('button')).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('收款')
})
it('enables a currently confirmed seller and pauses the same page on rebind until reconfirmed', () => {
  const show = (eligible: boolean) => <NextIntlClientProvider locale="zh-CN" messages={zh}>
    <TestnetBuy item={{ ...item, testnetPurchaseEligible: eligible }} />
  </NextIntlClientProvider>
  const view = render(show(true))
  expect(screen.getByRole('button')).toBeEnabled()
  view.rerender(show(false))
  expect(screen.getByRole('button')).toBeDisabled()
  view.rerender(show(true))
  expect(screen.getByRole('button')).toBeEnabled()
})
