import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HomeItemGrids } from '@/components/home/home-item-grids'
import type { BackendListing } from '@/lib/backend-api'

const listing = (type: 'physical' | 'digital', title: string): BackendListing => ({
  id: title,
  seller: { id: 'seller', displayName: 'Seller' },
  type,
  title,
  description: 'Description',
  category: type === 'digital' ? 'digital_assets' : 'electronics',
  price: { amount: '1', currency: 'USD' },
  priceUsd: null,
  publicationStatus: 'published',
  availability: type === 'digital' ? 'unlimited' : 'available',
  version: 1,
  licenseDescription: null,
  contentVersion: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
})

const homeState = vi.hoisted(() => ({ fail: false }))
afterEach(() => {
  homeState.fail = false
})

vi.mock('@/hooks/use-api-resource', () => ({
  useApiResource: (path: string) => {
    if (path !== '/listings/home') throw new Error(`Unexpected path ${path}`)
    return {
      data: {
        featured: [listing('physical', 'Featured')],
        digital: [listing('digital', 'Digital')],
        physical: [listing('physical', 'Physical')]
      },
      loading: false,
      error: homeState.fail ? 'REQUEST_FAILED' : null
    }
  }
}))

vi.mock('@/components/home/item-grid', () => ({
  ItemGrid: ({ items, title }: { items: { title: string }[]; title: string }) => (
    <section>
      {title}: {items.map((item) => item.title).join(', ')}
    </section>
  )
}))

it('renders independent catalog sections returned by the home API', () => {
  render(<HomeItemGrids />)
  expect(screen.getByText('featured: Featured')).toBeInTheDocument()
  expect(screen.getByText('digital: Digital')).toBeInTheDocument()
  expect(screen.getByText('physical: Physical')).toBeInTheDocument()
})

it('uses the featured listing from the home API in the editorial hero', () => {
  render(<HomeItemGrids />)
  expect(screen.getByRole('link', { name: 'Featured' })).toHaveAttribute(
    'href',
    '/listing/Featured'
  )
})

it('places digital listings before the general featured and physical sections', () => {
  const { container } = render(<HomeItemGrids />)
  const sections = [...container.querySelectorAll('section')].map((section) => section.textContent)
  expect(sections.findIndex((value) => value?.includes('digital: Digital'))).toBeLessThan(
    sections.findIndex((value) => value?.includes('featured: Featured'))
  )
})

it('offers a direct physical resale entry beside the digital-first catalog', () => {
  render(<HomeItemGrids />)
  expect(screen.getByRole('link', { name: 'browsePhysical' })).toHaveAttribute(
    'href',
    '/explore?type=physical'
  )
})

it('keeps the physical resale entry reachable when the home API fails', () => {
  homeState.fail = true
  render(<HomeItemGrids />)
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'browsePhysical' })).toHaveAttribute(
    'href',
    '/explore?type=physical'
  )
})
