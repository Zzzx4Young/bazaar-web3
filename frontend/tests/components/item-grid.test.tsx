import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ItemGrid } from '@/components/home/item-grid'
import type { Item } from '@/types'

const baseItem: Item = {
  id: 'item_x',
  sellerId: 'seller_x',
  title: 'Test product',
  description: '',
  category: 'physical',
  tags: [],
  price: { amount: 0, currency: 'CNY' },
  media: [],
  status: 'active',
  viewCount: 0,
  favoriteCount: 0,
  createdAt: '',
  updatedAt: ''
}

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  )
}))

const sellers = new Map()

describe('ItemGrid — search/empty variants', () => {
  it('renders the empty state when items list is empty', () => {
    render(<ItemGrid items={[]} sellers={sellers} />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  it('defaults to noResults variant when filter narrows items to 0', () => {
    render(<ItemGrid items={[]} sellers={sellers} />)
    // next-intl mock returns the leaf path; both title + description keys
    // must resolve under emptyState.noResults.*.
    expect(screen.getByText('noResults.title')).toBeInTheDocument()
    expect(screen.getByText('noResults.description')).toBeInTheDocument()
  })

  it('honors emptyVariant="noPublished"', () => {
    render(<ItemGrid items={[]} sellers={sellers} emptyVariant="noPublished" />)
    expect(screen.getByText('noPublished.title')).toBeInTheDocument()
  })

  it('renders no empty state when items.length > 0', () => {
    render(<ItemGrid items={[baseItem]} sellers={sellers} title="Hero" />)
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeInTheDocument()
  })

  it('explore-style filter that returns 0 items shows noResults, not noPublished', () => {
    // The page-level wiring in explore/page.tsx passes the filtered slice
    // into ItemGrid. Simulate the realistic case: a filter narrows 25 items
    // to 0 and the EmptyState must say "no matches", not "you haven't
    // listed anything".
    render(<ItemGrid items={[]} sellers={sellers} />) // default = noResults
    expect(screen.getByText('noResults.title')).toBeInTheDocument()
    expect(screen.queryByText('noPublished.title')).not.toBeInTheDocument()
  })
})
