import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  current: { items: [], loading: false, error: null, hasMore: false } as {
    items: typeof items
    loading: boolean
    error: string | null
    hasMore: boolean
  }
}))

vi.mock('@/hooks/use-backend-listings', () => ({
  useBackendListings: () => backend.current
}))

import FavoritesPage from '@/app/[locale]/favorites/page'

function seedFavorites(ids: string[]) {
  window.localStorage.setItem('c2c:user:favorites', JSON.stringify(ids))
}

describe('FavoritesPage server-backed listings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    backend.current = { items: [], loading: false, error: null, hasMore: false }
  })

  it('renders an empty state after the server returns no matching listings', () => {
    render(<FavoritesPage />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /explore/i })).toHaveAttribute('href', '/explore')
  })

  it('matches local favorite ids against current server listings', () => {
    backend.current = { items: items.slice(0, 2), loading: false, error: null, hasMore: false }
    seedFavorites([items[0]!.id])
    render(<FavoritesPage />)
    expect(screen.getByRole('heading', { name: '我的收藏 (1)' })).toBeInTheDocument()
    expect(screen.getByText(items[0]!.title)).toBeInTheDocument()
    expect(screen.queryByText(items[1]!.title)).not.toBeInTheDocument()
  })

  it('shows server failures instead of falling back to mock listings', () => {
    backend.current = { items: [], loading: false, error: 'NETWORK_ERROR', hasMore: false }
    seedFavorites([items[0]!.id])
    render(<FavoritesPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('NETWORK_ERROR')
    expect(screen.queryByText(items[0]!.title)).not.toBeInTheDocument()
  })

  it('removes stale local favorite ids after a complete server response', async () => {
    seedFavorites(['item_from_old_demo'])
    render(<FavoritesPage />)
    await waitFor(() => expect(window.localStorage.getItem('c2c:user:favorites')).toBe('[]'))
    expect(screen.getByRole('heading', { name: '我的收藏 (0)' })).toBeInTheDocument()
  })
})
