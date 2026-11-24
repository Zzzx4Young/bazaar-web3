import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { TestnetBuy } from '@/components/web3/testnet-buy'
import { useAuthStore } from '@/stores/use-auth-store'
import type { Item } from '@/types'
import zh from '@/../messages/zh-CN.json'
import { proxyApiRequest } from '@/lib/api-proxy'

afterEach(() => vi.unstubAllGlobals())
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

it('shows a sanitized proxy failure and permits an explicit purchase retry with the same key', async () => {
  const calls: { key: string | null }[] = []
  let recovered = false
  const logs: unknown[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      calls.push({ key: new Headers(init?.headers).get('Idempotency-Key') })
      return proxyApiRequest(new Request('http://front' + input, init),
        'http://127.0.0.1:1', (e) => logs.push(e))
    }
    if (!recovered) throw new TypeError('PRIVATE transport detail', {
      cause: { code: 'ECONNREFUSED' }
    })
    return Response.json({ orderId: 'created-order' })
  })
  render(<NextIntlClientProvider locale="zh-CN" messages={zh}>
    <TestnetBuy item={{ ...item, testnetPurchaseEligible: true }} />
  </NextIntlClientProvider>)
  fireEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('alert')).toHaveTextContent(zh.apiErrors.UNAVAILABLE)
  expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE')
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    (logs[0] as { proxyRequestId: string }).proxyRequestId)
  expect(screen.getByRole('button')).toBeEnabled()
  expect(useAuthStore.getState().status).toBe('authenticated')
  expect(calls).toHaveLength(1)
  recovered = true
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
  expect(calls).toHaveLength(2)
  expect(calls[1].key).toBe(calls[0].key)
  expect(calls[0].key).toMatch(/^[0-9a-f-]{36}$/)
})
