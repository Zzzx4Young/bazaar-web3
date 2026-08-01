import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import FavoritesPage from '@/app/[locale]/favorites/page'

// Mock the next-intl Link to render plain anchors so the test can read hrefs
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  )
}))

function seedFavoritesDirect(ids: string[]) {
  // Imperative: directly write localStorage so the store rehydrates with
  // these ids on its first render. Avoids React render-timing races.
  window.localStorage.setItem('c2c:user:favorites', JSON.stringify(ids))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('FavoritesPage — empty state', () => {
  it('shows empty state when no favorites', () => {
    render(<FavoritesPage />)
    expect(screen.getByText(/还没有收藏任何商品/)).toBeInTheDocument()
  })

  it('renders a link to explore when empty', () => {
    render(<FavoritesPage />)
    const link = screen.getByRole('link', { name: /去探索/ })
    expect(link.getAttribute('href')).toBe('/explore')
  })
})

describe('FavoritesPage — with items', () => {
  it('renders favorited items', () => {
    seedFavoritesDirect(['item_001', 'item_006'])
    render(<FavoritesPage />)
    expect(screen.getByText(/iPhone 15 Pro/)).toBeInTheDocument()
    expect(screen.getByText(/ENS 域名.*crypto\.eth/)).toBeInTheDocument()
  })

  it('shows count in heading', () => {
    seedFavoritesDirect(['item_001', 'item_006'])
    render(<FavoritesPage />)
    expect(screen.getByText(/我的收藏.*\(2\)/)).toBeInTheDocument()
  })

  it('links each item to its detail page', () => {
    seedFavoritesDirect(['item_001'])
    render(<FavoritesPage />)
    const link = screen.getByRole('link', { name: /iPhone 15 Pro/ })
    expect(link.getAttribute('href')).toBe('/listing/item_001')
  })

  it('does not render non-favorited items', () => {
    seedFavoritesDirect(['item_001'])
    render(<FavoritesPage />)
    // item_006 (ENS) is not favorited
    expect(screen.queryByText('ENS 域名：crypto.eth')).not.toBeInTheDocument()
  })
})

describe('FavoritesPage — handles stale favorite ids', () => {
  it('silently ignores favorited item ids that no longer exist', () => {
    seedFavoritesDirect(['item_does_not_exist'])
    render(<FavoritesPage />)
    // Should not crash, should show empty state
    expect(screen.getByText(/还没有收藏任何商品/)).toBeInTheDocument()
  })
})