import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SellerCard } from '@/components/listing/seller-card'

it('shows the actual seller identity without claiming it is a preset account', () => {
  render(<SellerCard seller={{ id: 'seller-1', displayName: 'Creator One' }} />)
  expect(screen.getByRole('link', { name: 'Creator One' })).toHaveAttribute('href', '/seller/seller-1')
  expect(screen.queryByText('Alpha 预置账户')).not.toBeInTheDocument()
})
