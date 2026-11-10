import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { IntentPanel } from '@/components/web3/intent-panel'
import { useAuthStore } from '@/stores/use-auth-store'
import zh from '@/../messages/zh-CN.json'
import type { PaymentPermit } from '@/lib/web3/escrow-client'
vi.unmock('next-intl')
const mocks = vi.hoisted(() => ({ post: vi.fn(), reload: vi.fn(), data: null as unknown }))
vi.mock('@/lib/authenticated-api', () => ({ authenticatedPost: mocks.post }))
vi.mock('@/hooks/use-api-resource', () => ({
  useApiResource: () => ({ data: mocks.data, reload: mocks.reload })
}))
const a = '0x' + '11'.repeat(20),
  b = '0x' + '22'.repeat(20),
  h = '0x' + '33'.repeat(32)
const permit: PaymentPermit = {
  schemaVersion: 1,
  intentId: h,
  orderId: h,
  stockId: h,
  stockGeneration: '0',
  previousOrderId: '0x' + '00'.repeat(32),
  chainId: 11155111,
  buyer: a,
  seller: b,
  refundAddress: a,
  token: b,
  escrow: b,
  amountAtoms: '1234567',
  commitmentHash: h,
  issuedAt: 1,
  payDeadline: 2000000000,
  signerKeyId: h
}
const view = {
  orderId: 'order',
  intentId: 'intent',
  permit,
  signature: '0x' + '11'.repeat(65),
  status: 'issued',
  protection: 'held'
}
const request = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  mocks.data = view
  useAuthStore.setState({
    status: 'authenticated',
    view: {
      csrfToken: 'session1',
      account: { id: 'buyer', loginName: 'buyer', displayName: 'Buyer', role: 'participant' }
    }
  })
  Object.defineProperty(window, 'ethereum', { configurable: true, value: { request } })
  request.mockImplementation(async ({ method }: { method: string }) =>
    method === 'eth_chainId'
      ? '0xaa36a7'
      : method === 'eth_accounts'
        ? [a]
        : method === 'eth_getCode'
          ? '0x'
          : h
  )
  mocks.post.mockImplementation(async (path: string) =>
    path.endsWith('/read')
      ? view
      : path.endsWith('transaction-attempts')
        ? { id: 'attempt' }
        : path.endsWith('/refresh')
          ? { status: 'finalized' }
          : {}
  )
})
const show = () =>
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zh}>
      <IntentPanel orderId="order" intentId="intent" onRefresh={mocks.reload} />
    </NextIntlClientProvider>
  )
describe('payment UI trust boundaries', () => {
  it('approval submission remains distinct from payment', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: '1. 按本单金额授权' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('授权不代表付款'))
    expect(mocks.post.mock.calls.some(([p]) => p.includes('transaction-attempts'))).toBe(false)
  })
  it('wrong current wallet cannot pay the old fixed-wallet order', async () => {
    request.mockImplementation(async ({ method }: { method: string }) =>
      method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_accounts' ? [b] : '0x'
    )
    show()
    await userEvent.click(screen.getByRole('button', { name: '2. 托管入金' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('订单固定钱包')
    expect(request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false)
  })
  it('wallet rejection is not rendered as payment failure', async () => {
    request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_sendTransaction') throw { code: 4001 }
      return method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_accounts' ? [a] : '0x'
    })
    show()
    await userEvent.click(screen.getByRole('button', { name: '2. 托管入金' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('不表示链上付款失败')
  })
  it('finalized transaction hint does not confirm the business payment', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: '2. 托管入金' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('交易已提交'))
    await userEvent.click(screen.getByRole('button', { name: '重新核对' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('尚未完成双源最终确认')
    )
  })
  it('revoked session while read is pending cannot send a transaction', async () => {
    let resolve!: (v: unknown) => void
    mocks.post.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    show()
    await userEvent.click(screen.getByRole('button', { name: '2. 托管入金' }))
    useAuthStore.setState({ view: null, status: 'anonymous' })
    resolve(view)
    await screen.findByRole('alert')
    expect(request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false)
  })
})

it('wallet timeout preserves unknown outcome and warns against repeating payment', async () => {
  request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_sendTransaction') throw new Error('timeout')
    return method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_accounts' ? [a] : '0x'
  })
  show()
  await userEvent.click(screen.getByRole('button', { name: '2. 托管入金' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('请求结果未知')
  expect(screen.getByRole('status')).toHaveTextContent('结果核对中')
})

it('an included approval is displayed separately and never as a finalized payment', async () => {
  request.mockImplementation(async ({ method }: { method: string }) =>
    method === 'eth_getTransactionReceipt'
      ? { status: '0x1' }
      : method === 'eth_chainId'
        ? '0xaa36a7'
        : method === 'eth_accounts'
          ? [a]
          : method === 'eth_getCode'
            ? '0x'
            : h
  )
  show()
  await userEvent.click(screen.getByRole('button', { name: '1. 按本单金额授权' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('授权交易已提交'))
  await userEvent.click(screen.getByRole('button', { name: '重新核对' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('授权已上链'))
  expect(screen.getByRole('status')).not.toHaveTextContent('已通过双源最终确认')
})
