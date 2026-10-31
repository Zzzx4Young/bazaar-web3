import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ListingFacts } from '@/components/listing/listing-facts'
import type { Item } from '@/types'

const item = {
  id: 'digital-1',
  sellerId: 'seller-1',
  title: 'Atlas pack',
  description: 'Description',
  category: 'digital',
  tags: [],
  price: { amount: 18, currency: 'USD' },
  media: [],
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
} as Item

it('marks missing seller rights and version as missing, without inventing a transaction type', () => {
  render(<ListingFacts item={item} />)
  expect(screen.getAllByText('notProvided')).toHaveLength(2)
  expect(screen.getByText('notRecorded')).toBeInTheDocument()
  expect(screen.queryByText(/ownership transfer/i)).not.toBeInTheDocument()
})

it('renders seller supplied rights, version and delivery method', () => {
  render(
    <ListingFacts
      item={{
        ...item,
        licenseDescription: 'Personal use only',
        contentVersion: 'v2',
        deliveryType: 'download_link'
      }}
    />
  )
  expect(screen.getByText('Personal use only')).toBeInTheDocument()
  expect(screen.getByText('v2')).toBeInTheDocument()
  expect(screen.getByText('deliveryDownloadLink')).toBeInTheDocument()
  expect(screen.queryByText('notProvided')).not.toBeInTheDocument()
})

it('labels fields absent from the live listing API as unrecorded', async () => {
  const { toItem } = await import('@/lib/backend-api')
  const listing = {
    id: 'live-1',
    seller: { id: 'seller-1', displayName: 'Seller One' },
    type: 'physical' as const,
    saleMode: 'one_off' as const,
    canEdit: false,
    title: 'Camera',
    description: 'Used camera',
    category: 'electronics',
    price: { amount: '20', currency: 'CNY' },
    priceUsd: null,
    publicationStatus: 'published' as const,
    availability: 'available',
    version: 1,
    licenseDescription: null,
    contentVersion: null,
    media: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  }
  render(<ListingFacts item={toItem(listing)} />)
  expect(screen.getAllByText('notRecorded')).toHaveLength(2)
  expect(screen.queryByText('notProvided')).not.toBeInTheDocument()
})
