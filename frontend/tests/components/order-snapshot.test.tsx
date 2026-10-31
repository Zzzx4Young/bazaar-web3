import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrderSnapshot } from '@/components/me/order-snapshot'
import type { OrderDetail } from '@/lib/order-api'

const snapshot: OrderDetail['snapshot'] = {
  listingVersion: 2,
  title: 'Atlas resource',
  description: 'What the buyer saw at purchase',
  type: 'digital',
  category: 'software_source',
  price: { amount: '12.5', currency: 'CNY' },
  licenseDescription: 'Personal use only',
  contentVersion: 'v2',
  media: []
}

it('shows seller rights and version for a digital purchase snapshot', () => {
  render(<OrderSnapshot type="digital" snapshot={snapshot} />)
  expect(screen.getByText('Personal use only')).toBeInTheDocument()
  expect(screen.getByText('v2')).toBeInTheDocument()
})

it('shows physical description without inapplicable digital rights labels', () => {
  render(
    <OrderSnapshot
      type="physical"
      snapshot={{ ...snapshot, type: 'physical', licenseDescription: null, contentVersion: null }}
    />
  )
  expect(screen.getByText('What the buyer saw at purchase')).toBeInTheDocument()
  expect(screen.queryByText('license')).not.toBeInTheDocument()
  expect(screen.queryByText('version')).not.toBeInTheDocument()
})
