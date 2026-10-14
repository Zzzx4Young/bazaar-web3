import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BuyModal } from '@/components/listing/buy-modal'
import { useAuthStore } from '@/stores/use-auth-store'
import type { Item } from '@/types'

const item: Item = {
  id: 'listing-1',
  sellerId: 'seller-1',
  backendVersion: 1,
  title: 'Test Item',
  description: 'desc',
  category: 'physical',
  tags: [],
  price: { amount: 100, currency: 'CNY' },
  media: [],
  status: 'active',
  viewCount: 0,
  favoriteCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
})

describe('BuyModal', () => {
  it('shows the backend order boundary and requires authentication', () => {
    render(<BuyModal item={item} open onOpenChange={vi.fn()} />)
    expect(screen.getByText('description')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('signIn')
    expect(screen.getByRole('button', { name: 'confirm' })).toBeDisabled()
  })

  it('renders shipping fields only for physical listings', () => {
    render(<BuyModal item={item} open onOpenChange={vi.fn()} />)
    expect(screen.getByLabelText('recipient')).toBeInTheDocument()
    cleanup()
    const digital = { ...item, category: 'digital' as const }
    render(<BuyModal item={digital} open onOpenChange={vi.fn()} />)
    expect(screen.queryByLabelText('recipient')).not.toBeInTheDocument()
  })
})
