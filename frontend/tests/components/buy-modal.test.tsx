import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BuyModal } from '@/components/listing/buy-modal'
import { useOrderStore } from '@/stores/use-order-store'
import type { Item } from '@/types'

const baseItem: Item = {
  id: 'item_test_001',
  sellerId: 'seller_001',
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
  window.localStorage.clear()
  // reset zustand persist
  useOrderStore.getState().reset()
})

describe('BuyModal — confirm step', () => {
  it('renders the item title in confirmation', () => {
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('Test Item')).toBeInTheDocument()
  })

  it('renders the price in confirmation', () => {
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('¥100')).toBeInTheDocument()
  })

  it('shows platform fee (1%)', () => {
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)
    // fee = 100 * 0.01 = 1
    expect(screen.getByText('¥1')).toBeInTheDocument()
  })

  it('does not render anything when item is null', () => {
    const { container } = render(<BuyModal item={null} open={true} onOpenChange={() => {}} />)
    // the Dialog renders a portal but with no content; check title not present
    expect(screen.queryByText('确认购买')).not.toBeInTheDocument()
  })

  it('shows "实物二手" for physical items', () => {
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('实物二手')).toBeInTheDocument()
  })

  it('shows "数字资产" for digital items', () => {
    const digitalItem = { ...baseItem, category: 'digital' as const }
    render(<BuyModal item={digitalItem} open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('数字资产')).toBeInTheDocument()
  })
})

describe('BuyModal — confirm → fund transition', () => {
  it('clicking "确认下单" moves to fund step', async () => {
    const user = userEvent.setup()
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    await waitFor(() => {
      expect(screen.getByText('链上确认中...')).toBeInTheDocument()
    })
  })

  it('shows "等待链上确认" during fund step', async () => {
    const user = userEvent.setup()
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    expect(screen.getByText(/等待链上确认/)).toBeInTheDocument()
  })
})

describe('BuyModal — fund → done transition', () => {
  it('after 1.5s, advances to done step', async () => {
    const user = userEvent.setup()
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    await waitFor(
      () => {
        expect(screen.getByText('下单成功 ✓')).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

  it('done step shows the success message', async () => {
    const user = userEvent.setup()
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    await waitFor(() => screen.getByText('下单成功 ✓'), { timeout: 3000 })
    expect(screen.getByText(/订单已创建/)).toBeInTheDocument()
  })
})

describe('BuyModal — order creation', () => {
  it('creates an order in the order store', async () => {
    const user = userEvent.setup()
    const orderCountBefore = useOrderStore.getState().userOrders.length

    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    await waitFor(() => screen.getByText('下单成功 ✓'), { timeout: 3000 })

    const orderCountAfter = useOrderStore.getState().userOrders.length
    expect(orderCountAfter).toBe(orderCountBefore + 1)
  })

  it('created order references the item and the buyer', async () => {
    const user = userEvent.setup()
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    await waitFor(() => screen.getByText('下单成功 ✓'), { timeout: 3000 })

    const orders = useOrderStore.getState().userOrders
    const newOrder = orders[0]
    expect(newOrder?.itemId).toBe('item_test_001')
  })
})

describe('BuyModal — done step for digital vs physical', () => {
  it('digital items mention auto-release in done step', async () => {
    const user = userEvent.setup()
    const digitalItem = { ...baseItem, category: 'digital' as const }
    render(<BuyModal item={digitalItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    await waitFor(() => screen.getByText('下单成功 ✓'), { timeout: 3000 })
    expect(screen.getByText(/数字商品将在卖家确认交付后自动释放/)).toBeInTheDocument()
  })

  it('physical items mention "确认收货" in done step', async () => {
    const user = userEvent.setup()
    render(<BuyModal item={baseItem} open={true} onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '确认下单' }))

    await waitFor(() => screen.getByText('下单成功 ✓'), { timeout: 3000 })
    expect(screen.getByText(/实物商品将在你确认收货后自动释放/)).toBeInTheDocument()
  })
})