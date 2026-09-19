import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Module-level mocks BEFORE importing the component
const mockFavorites: { current: string[] } = { current: [] }

vi.mock('@/hooks/use-resolved-favorites', () => ({
  useResolvedFavorites: () => ({ items: mockFavorites.current, loading: false, error: null })
}))

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
  usePathname: () => '/favorites'
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key
}))

// Now import the component (after mocks)
import { FavoritesLink } from '@/components/layout/favorites-link'

describe('FavoritesLink', () => {
  beforeEach(() => {
    mockFavorites.current = []
  })

  it('shows the link text', () => {
    render(<FavoritesLink />)
    expect(screen.getByText('favorites')).toBeInTheDocument()
  })

  it('links to /favorites', () => {
    render(<FavoritesLink />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/favorites')
  })

  it('does not show a badge when there are no favorites', () => {
    render(<FavoritesLink />)
    expect(screen.queryByLabelText(/\d+ favorites/)).not.toBeInTheDocument()
  })

  it('shows a badge with the count when there are favorites', () => {
    mockFavorites.current = ['item_001', 'item_006', 'item_011']
    render(<FavoritesLink />)
    expect(screen.getByLabelText('3 favorites')).toHaveTextContent('3')
  })

  it('updates the badge when a favorite is toggled', () => {
    mockFavorites.current = ['item_001']
    const { rerender } = render(<FavoritesLink />)
    expect(screen.getByLabelText('1 favorites')).toBeInTheDocument()

    // Simulate toggle removing the favorite
    mockFavorites.current = []
    rerender(<FavoritesLink />)
    expect(screen.queryByLabelText(/\d+ favorites/)).not.toBeInTheDocument()

    // Simulate adding another
    mockFavorites.current = ['item_001', 'item_006']
    rerender(<FavoritesLink />)
    expect(screen.getByLabelText('2 favorites')).toBeInTheDocument()
  })

  it('handles double-digit counts', () => {
    mockFavorites.current = Array.from({ length: 12 }, (_, i) =>
      `item_${String(i + 1).padStart(3, '0')}`
    )
    render(<FavoritesLink />)
    expect(screen.getByLabelText('12 favorites')).toBeInTheDocument()
  })
})
