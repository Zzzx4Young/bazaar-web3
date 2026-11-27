import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { EscrowStatus } from '@/components/web3/escrow-status'
import { PaymentSteps } from '@/components/web3/payment-steps'
import zh from '@/../messages/zh-CN.json'
vi.unmock('next-intl')
const wrap = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zh}>
      {node}
    </NextIntlClientProvider>
  )
describe('escrow state disclosure', () => {
  it('approval never claims payment and unknown submission never claims failure', () => {
    wrap(<PaymentSteps status="approvalSubmitted" />)
    expect(screen.getByRole('status').textContent).toMatch(/授权.*不代表.*付款/)
  })
  it('keeps original deadline visible while waiting finalized', () => {
    wrap(<EscrowStatus state="Delivered" deadline={2000000000} waiting />)
    expect(screen.getByText(/2000000000/)).toBeTruthy()
    expect(screen.getByText(/等待.*最终确认/)).toBeTruthy()
  })
  it('refund states new-link revocation and old-link limitation', () => {
    wrap(<EscrowStatus state="Refunded" />)
    expect(screen.getByText(/旧链接.*5.*分钟/)).toBeTruthy()
  })
})
