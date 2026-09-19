import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Item } from '@/types'

const items: Item[] = [
  {
    id: 'listing-1',
    sellerId: 'seller-1',
    sellerDisplayName: 'Seller One',
    title: 'Server listing one',
    description: 'First server-backed listing',
    category: 'physical',
    primaryCategory: 'electronics',
    tags: [],
    price: { amount: 10, exactAmount: '10.00', currency: 'USD' },
    media: [],
    status: 'active',
    viewCount: 0,
    favoriteCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'listing-2',
    sellerId: 'seller-2',
    sellerDisplayName: 'Seller Two',
    title: 'Server listing two',
    description: 'Second server-backed listing',
    category: 'digital',
    primaryCategory: 'digital_assets',
    tags: [],
    price: { amount: 2, exactAmount: '2.00', currency: 'USD' },
    media: [],
    status: 'active',
    viewCount: 0,
    favoriteCount: 0,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z'
  }
]

const backend = vi.hoisted(() => ({
  current: { items: [], loading: false, error: null } as {
    items: typeof items
    loading: boolean
    error: string | null
  }
}))

vi.mock('@/hooks/use-resolved-favorites', () => ({
  useResolvedFavorites: () => backend.current
}))

import FavoritesPage from '@/app/[locale]/favorites/page'

describe('FavoritesPage server-backed listings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    backend.current = { items: [], loading: false, error: null }
  })

  it('renders an empty state after the server returns no matching listings', () => {
    render(<FavoritesPage />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /explore/i })).toHaveAttribute('href', '/explore')
  })

  it('shows exactly the listings resolved by the favorites API', () => {
    backend.current = { items: items.slice(0, 1), loading: false, error: null }
    render(<FavoritesPage />)
    expect(screen.getByRole('heading', { name: '我的收藏 (1)' })).toBeInTheDocument()
    expect(screen.getByText(items[0]!.title)).toBeInTheDocument()
    expect(screen.queryByText(items[1]!.title)).not.toBeInTheDocument()
  })

  it('shows server failures instead of falling back to mock listings', () => {
    backend.current = { items: [], loading: false, error: 'NETWORK_ERROR' }
    render(<FavoritesPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('NETWORK_ERROR')
    expect(screen.queryByText(items[0]!.title)).not.toBeInTheDocument()
  })

  it('does not count stale local ids missing from the API response', () => {
    window.localStorage.setItem('c2c:user:favorites', JSON.stringify(['item_from_old_demo']))
    render(<FavoritesPage />)
    expect(screen.getByRole('heading', { name: '我的收藏 (0)' })).toBeInTheDocument()
  })
})
