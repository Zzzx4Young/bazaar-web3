import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SellerPage from '@/app/[locale]/seller/[id]/page'

const fixture = vi.hoisted(() => ({ total: 51 }))

vi.mock('@/hooks/use-backend-listings', () => ({
  useBackendListings: (params: URLSearchParams) => {
    const page = Number(params.get('page'))
    const limit = Number(params.get('limit'))
    const first = (page - 1) * limit
    return {
      items: Array.from({ length: Math.max(0, Math.min(limit, fixture.total - first)) }, (_, index) => ({
        id: `listing-${first + index + 1}`
      })),
      loading: false,
      error: null,
      total: fixture.total,
      hasMore: page * limit < fixture.total,
      page
    }
  }
}))

vi.mock('@/hooks/use-api-resource', () => ({
  useApiResource: () => ({
    data: { id: 'seller-1', displayName: 'Seller', reputation: { rating: null, ratingCount: 0 } },
    loading: false,
    error: null
  })
}))

vi.mock('@/components/home/item-grid', () => ({
  ItemGrid: ({ items }: { items: { id: string }[] }) => (
    <div>{items.map((item) => <span data-testid="seller-listing" key={item.id}>{item.id}</span>)}</div>
  )
}))

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  fixture.total = 51
})

it('paginates all public seller listings instead of stopping at the first 50', () => {
  render(<SellerPage params={{ id: 'seller-1' }} />)
  expect(screen.getByText('listing-1')).toBeInTheDocument()
  expect(screen.getByText('共 51 条 · 第 1 / 3 页')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('listing-19')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('listing-37')).toBeInTheDocument()
  expect(screen.getByText('listing-51')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  expect(sessionStorage.getItem('bazaar:seller:seller-1')).toBe('3')
})

it('shows 18 listings on the first seller page and the remaining six on the next', () => {
  fixture.total = 24
  render(<SellerPage params={{ id: 'seller-1' }} />)
  expect(screen.getAllByTestId('seller-listing')).toHaveLength(18)
  expect(screen.getByText('共 24 条 · 第 1 / 2 页')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getAllByTestId('seller-listing')).toHaveLength(6)
  expect(screen.getByText('listing-19')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
})
