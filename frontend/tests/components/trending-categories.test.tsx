import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  )
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key
}))

import { TrendingCategories } from '@/components/home/trending-categories'

describe('TrendingCategories', () => {
  it('renders a section with a view-all link', () => {
    render(<TrendingCategories />)
    expect(screen.getByTestId('trending-categories')).toBeInTheDocument()
    const viewAll = screen.getByRole('link', { name: /view all|viewall/i })
    expect(viewAll).toBeInTheDocument()
  })

  it('renders one category card per category in mock data', () => {
    render(<TrendingCategories />)
    const region = screen.getByRole('region')
    const links = region.querySelectorAll('a[href^="/explore?category="]')
    expect(links.length).toBeGreaterThanOrEqual(4)
  })
})
