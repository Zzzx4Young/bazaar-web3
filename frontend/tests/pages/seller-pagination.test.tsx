import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SellerPage from '@/app/[locale]/seller/[id]/page'
import { PUBLIC_LISTINGS_PAGE_SIZE } from '@/lib/pagination'

vi.mock('@/hooks/use-backend-listings', () => ({
  useBackendListings: (params: URLSearchParams) => {
    const page = Number(params.get('page'))
    return {
      items: [{ id: `listing-page-${page}` }],
      loading: false,
      error: null,
      total: 51,
      hasMore: page < 3,
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
  ItemGrid: ({ items }: { items: { id: string }[] }) => <div>{items.map((item) => item.id)}</div>
}))

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

it('paginates all public seller listings instead of stopping at the first 50', () => {
  render(<SellerPage params={{ id: 'seller-1' }} />)
  expect(screen.getByText('listing-page-1')).toBeInTheDocument()
  expect(screen.getByText(`共 51 条 · 第 1 / ${Math.ceil(51 / PUBLIC_LISTINGS_PAGE_SIZE)} 页`))
    .toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('listing-page-2')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('listing-page-3')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  expect(sessionStorage.getItem('bazaar:seller:seller-1')).toBe('3')
})
