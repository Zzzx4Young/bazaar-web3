import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ItemCard } from '@/components/home/item-card'
import type { Item, Seller } from '@/types'

const baseItem: Item = {
  id: 'item_001',
  sellerId: 'seller_001',
  title: 'iPhone 15 Pro 99新',
  description: 'test',
  category: 'physical',
  tags: [],
  price: { amount: 6899, currency: 'CNY' },
  media: [
    { type: 'image', url: 'https://placehold.co/600x400/000/fff?text=iPhone', alt: 'iPhone' }
  ],
  status: 'active',
  viewCount: 0,
  favoriteCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}

const baseSeller: Seller = {
  id: 'seller_001',
  displayName: 'mobile_zone',
  avatarSeed: 'mobile',
  joinedAt: '2024-01-01T00:00:00Z',
  completedOrders: 100,
  rating: 4.8,
  ratingCount: 90,
  activeItemIds: []
}

describe('ItemCard', () => {
  it('displays supplied media and falls back only for missing or failed images', () => {
    const { rerender } = render(<ItemCard item={baseItem} />)
    expect(screen.getByRole('img', { name: 'iPhone' })).toHaveAttribute(
      'src',
      baseItem.media[0]!.url
    )
    expect(screen.queryByTestId('placeholder-art')).not.toBeInTheDocument()
    fireEvent.error(screen.getByRole('img', { name: 'iPhone' }))
    expect(screen.getByTestId('placeholder-art')).toBeInTheDocument()
    const replacement = {
      ...baseItem,
      media: [{ type: 'image' as const, url: 'https://placehold.co/new.png', alt: 'Replacement' }]
    }
    rerender(<ItemCard item={replacement} />)
    expect(screen.getByRole('img', { name: 'Replacement' })).toHaveAttribute(
      'src',
      replacement.media[0]!.url
    )
    rerender(<ItemCard item={{ ...baseItem, media: [] }} />)
    expect(screen.getByTestId('placeholder-art')).toBeInTheDocument()
  })
  it('renders the item title', () => {
    render(<ItemCard item={baseItem} />)
    expect(screen.getByText('iPhone 15 Pro 99新')).toBeInTheDocument()
  })

  it('renders the formatted price', () => {
    render(<ItemCard item={baseItem} />)
    expect(screen.getByText('¥6,899')).toBeInTheDocument()
  })

  it('links to the listing detail page', () => {
    render(<ItemCard item={baseItem} />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/listing/item_001')
  })

  it('shows seller name when provided', () => {
    render(<ItemCard item={baseItem} seller={baseSeller} />)
    expect(screen.getByText('mobile_zone')).toBeInTheDocument()
  })

  it('hides seller name when not provided', () => {
    render(<ItemCard item={baseItem} />)
    expect(screen.queryByText('mobile_zone')).not.toBeInTheDocument()
  })

  it('shows "数字" badge for digital items', () => {
    const digitalItem: Item = { ...baseItem, id: 'item_002', category: 'digital' }
    render(<ItemCard item={digitalItem} />)
    expect(screen.getByText('数字')).toBeInTheDocument()
  })

  it('does NOT show "数字" badge for physical items', () => {
    render(<ItemCard item={baseItem} />)
    expect(screen.queryByText('数字')).not.toBeInTheDocument()
  })

  it('shows "降价" badge when originalPrice is higher than price', () => {
    const discountedItem: Item = {
      ...baseItem,
      price: { amount: 5000, currency: 'CNY' },
      originalPrice: { amount: 6899, currency: 'CNY' }
    }
    render(<ItemCard item={discountedItem} />)
    expect(screen.getByText('降价')).toBeInTheDocument()
  })

  it('does NOT show "降价" badge when no originalPrice', () => {
    render(<ItemCard item={baseItem} />)
    expect(screen.queryByText('降价')).not.toBeInTheDocument()
  })

  it('does NOT show "降价" badge when originalPrice is not higher', () => {
    const samePriceItem: Item = {
      ...baseItem,
      price: { amount: 5000, currency: 'CNY' },
      originalPrice: { amount: 5000, currency: 'CNY' }
    }
    render(<ItemCard item={samePriceItem} />)
    expect(screen.queryByText('降价')).not.toBeInTheDocument()
  })

  it('shows comparable facts supplied by the seller without inventing missing rights', () => {
    const digitalItem: Item = {
      ...baseItem,
      category: 'digital',
      contentVersion: 'v2.4',
      licenseDescription: 'Personal use only'
    }
    const { rerender } = render(<ItemCard item={digitalItem} />)
    expect(screen.getByText(/v2.4/)).toBeInTheDocument()
    expect(screen.getByText(/Personal use only/)).toBeInTheDocument()
    rerender(
      <ItemCard
        item={{ ...digitalItem, contentVersion: undefined, licenseDescription: undefined }}
      />
    )
    expect(screen.queryByText(/v2.4/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Personal use only/)).not.toBeInTheDocument()
  })

  it('shows condition and delivery for a physical listing', () => {
    render(<ItemCard item={{ ...baseItem, condition: 'good', shippingMethod: 'delivery' }} />)
    expect(screen.getByText(/conditionGood/)).toBeInTheDocument()
    expect(screen.getByText(/shippingDelivery/)).toBeInTheDocument()
  })

  it('shows original price line-through when discounted', () => {
    const discountedItem: Item = {
      ...baseItem,
      price: { amount: 5000, currency: 'CNY' },
      originalPrice: { amount: 6899, currency: 'CNY' }
    }
    render(<ItemCard item={discountedItem} />)
    expect(screen.getByText('¥6,899')).toBeInTheDocument()
  })
})
