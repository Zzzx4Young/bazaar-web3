import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOrderStore, selectAllOrders, selectByBuyer, selectBySeller } from '@/stores/use-order-store'
import type { OrderStatus } from '@/types'

beforeEach(() => {
  window.localStorage.clear()
})

describe('useOrderStore — initial state', () => {
  it('starts with empty user orders', () => {
    const { result } = renderHook(() => useOrderStore())
    expect(result.current.userOrders).toEqual([])
  })
})

describe('useOrderStore — create', () => {
  it('adds a new order with auto-generated id and createdAt', () => {
    const { result } = renderHook(() => useOrderStore())
    let created: ReturnType<typeof result.current.create> | undefined
    act(() => {
      created = result.current.create({
        itemId: 'item_001',
        buyerId: 'user_1',
        sellerId: 'seller_1',
        amount: { amount: 100, currency: 'CNY' },
        status: 'pending_payment' as OrderStatus,
        role: 'buyer'
      })
    })
    expect(created?.id).toMatch(/^order_user_\d+_[a-z0-9]+$/)
    expect(created?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.current.userOrders).toContainEqual(created)
  })

  it('prepends new orders (newest first)', () => {
    const { result } = renderHook(() => useOrderStore())
    act(() => {
      result.current.create({ itemId: 'i1', buyerId: 'u', sellerId: 's', amount: { amount: 1, currency: 'CNY' }, status: 'pending_payment' as OrderStatus })
    })
    const firstId = result.current.userOrders[0]?.id

    act(() => {
      result.current.create({ itemId: 'i2', buyerId: 'u', sellerId: 's', amount: { amount: 2, currency: 'CNY' }, status: 'pending_payment' as OrderStatus })
    })
    // newest should be at index 0
    expect(result.current.userOrders[0]?.itemId).toBe('i2')
    expect(result.current.userOrders[1]?.itemId).toBe('i1')
    // previous firstId is no longer at index 0
    expect(result.current.userOrders[0]?.id).not.toBe(firstId)
  })
})

describe('useOrderStore — updateStatus', () => {
  it('updates status of an existing user order', () => {
    const { result } = renderHook(() => useOrderStore())
    let orderId = ''
    act(() => {
      const order = result.current.create({
        itemId: 'i1', buyerId: 'u', sellerId: 's',
        amount: { amount: 1, currency: 'CNY' },
        status: 'pending_payment' as OrderStatus
      })
      orderId = order.id
    })

    act(() => {
      result.current.updateStatus(orderId, 'completed' as OrderStatus)
    })
    const updated = result.current.userOrders.find(o => o.id === orderId)
    expect(updated?.status).toBe('completed')
  })

  it('does not affect other orders', () => {
    const { result } = renderHook(() => useOrderStore())
    let id1 = '', id2 = ''
    act(() => {
      id1 = result.current.create({ itemId: 'i1', buyerId: 'u', sellerId: 's', amount: { amount: 1, currency: 'CNY' }, status: 'pending_payment' as OrderStatus }).id
      id2 = result.current.create({ itemId: 'i2', buyerId: 'u', sellerId: 's', amount: { amount: 2, currency: 'CNY' }, status: 'pending_payment' as OrderStatus }).id
    })

    act(() => {
      result.current.updateStatus(id1, 'completed' as OrderStatus)
    })
    expect(result.current.userOrders.find(o => o.id === id1)?.status).toBe('completed')
    expect(result.current.userOrders.find(o => o.id === id2)?.status).toBe('pending_payment')
  })

  it('is a no-op when orderId is not in userOrders', () => {
    const { result } = renderHook(() => useOrderStore())
    const before = [...result.current.userOrders]
    act(() => {
      result.current.updateStatus('nonexistent_id', 'completed' as OrderStatus)
    })
    expect(result.current.userOrders).toEqual(before)
  })
})

describe('useOrderStore — byBuyer / bySeller (selectors)', () => {
  it('byBuyer includes both user and static orders for that buyer', () => {
    const { result } = renderHook(() => useOrderStore())
    act(() => {
      result.current.create({ itemId: 'i1', buyerId: 'buyer_x', sellerId: 's', amount: { amount: 1, currency: 'CNY' }, status: 'pending_payment' as OrderStatus })
    })
    const userBuyerOrders = selectByBuyer('buyer_x')(result.current)
    expect(userBuyerOrders.length).toBeGreaterThan(0)
    expect(userBuyerOrders.every(o => o.buyerId === 'buyer_x')).toBe(true)
  })

  it('bySeller includes both user and static orders for that seller', () => {
    const { result } = renderHook(() => useOrderStore())
    act(() => {
      result.current.create({ itemId: 'i1', buyerId: 'b', sellerId: 'seller_y', amount: { amount: 1, currency: 'CNY' }, status: 'pending_payment' as OrderStatus })
    })
    const sellerOrders = selectBySeller('seller_y')(result.current)
    expect(sellerOrders.length).toBeGreaterThan(0)
    expect(sellerOrders.every(o => o.sellerId === 'seller_y')).toBe(true)
  })

  it('byBuyer returns empty for unknown buyer', () => {
    const { result } = renderHook(() => useOrderStore())
    expect(selectByBuyer('nobody')(result.current)).toEqual([])
  })

  it('bySeller returns empty for unknown seller', () => {
    const { result } = renderHook(() => useOrderStore())
    expect(selectBySeller('nobody')(result.current)).toEqual([])
  })
})

describe('selectAllOrders', () => {
  it('returns user orders prepended to static orders', () => {
    const { result } = renderHook(() => useOrderStore())
    act(() => {
      result.current.create({ itemId: 'i1', buyerId: 'b', sellerId: 's', amount: { amount: 1, currency: 'CNY' }, status: 'pending_payment' as OrderStatus })
    })
    const all = selectAllOrders(result.current)
    expect(all.length).toBe(result.current.userOrders.length + 12) // 12 static orders
    expect(all[0]?.itemId).toBe('i1')
  })
})