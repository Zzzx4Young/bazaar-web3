import { beforeEach, expect, test } from 'vitest'
import { useCartStore } from '@/stores/use-cart-store'
import type { Item } from '@/types'
import { cartMaxItems } from '@/lib/cart-policy'

const item = (id: string): Item => ({
  id,
  backendVersion: 1,
  sellerId: 'seller',
  title: `Item ${id}`,
  description: 'Cart test',
  category: 'physical',
  tags: [],
  price: { amount: 12.5, exactAmount: '12.50', currency: 'USD' },
  media: [],
  status: 'active',
  viewCount: 0,
  favoriteCount: 0,
  createdAt: '2026-09-22T00:00:00Z',
  updatedAt: '2026-09-22T00:00:00Z'
})

beforeEach(() => useCartStore.setState({ ownerId: null, items: [] }))

test('cart rejects additions beyond the checkout contract limit', () => {
  for (let i = 0; i < cartMaxItems + 1; i++) useCartStore.getState().add('buyer', item(String(i)))
  expect(useCartStore.getState().items).toHaveLength(cartMaxItems)
  expect(useCartStore.getState().items.some((line) => line.listingId === String(cartMaxItems))).toBe(false)
})

test('cart keeps one line per listing and never exposes a previous account cart', () => {
  const cart = useCartStore.getState()
  cart.add('buyer-a', item('first'))
  cart.add('buyer-a', item('first'))
  cart.add('buyer-a', item('second'))
  expect(useCartStore.getState().items.map((line) => line.listingId)).toEqual(['first', 'second'])
  cart.add('buyer-b', item('third'))
  expect(useCartStore.getState().ownerId).toBe('buyer-b')
  expect(useCartStore.getState().items.map((line) => line.listingId)).toEqual(['third'])
  cart.clear('buyer-a')
  expect(useCartStore.getState().items).toHaveLength(1)
})
