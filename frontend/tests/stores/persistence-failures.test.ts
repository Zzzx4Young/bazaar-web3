import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOrderStore } from '@/stores/use-order-store'
import { useItemStore } from '@/stores/use-item-store'
import { items } from '@/lib/mock-data'
import { decodeItemCache } from '@/lib/item-cache'

const input = {
  itemId: 'i1',
  buyerId: 'b1',
  sellerId: 's1',
  amount: { amount: 1, currency: 'CNY' as const },
  status: 'pending_fulfillment' as const
}
beforeEach(() => {
  localStorage.clear()
  useOrderStore.getState().reset()
})
afterEach(() => vi.restoreAllMocks())

describe('order write atomicity', () => {
  it.each(['create', 'updateStatus', 'reset'] as const)(
    '%s leaves memory and disk unchanged on storage failure',
    (action) => {
      const order = useOrderStore.getState().create(input)
      const before = useOrderStore.getState().userOrders
      const disk = localStorage.getItem('c2c:orders')
      const listener = vi.fn()
      const unsubscribe = useOrderStore.subscribe(listener)
      const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })
      try {
        expect(() => {
          const state = useOrderStore.getState()
          if (action === 'create') state.create(input)
          else if (action === 'updateStatus') state.updateStatus(order.id, 'completed')
          else state.reset()
        }).toThrow()
        expect(useOrderStore.getState().userOrders).toBe(before)
        expect(localStorage.getItem('c2c:orders')).toBe(disk)
        expect(listener).not.toHaveBeenCalled()
      } finally {
        unsubscribe()
        write.mockRestore()
      }
      useOrderStore.getState().create(input)
      expect(useOrderStore.getState().userOrders).toHaveLength(2)
      expect(JSON.parse(localStorage.getItem('c2c:orders')!).state.userOrders).toHaveLength(2)
    }
  )
})

describe('item cache recovery', () => {
  const valid = { ...items[0]!, id: 'local_valid', primaryCategory: undefined }
  it.each([
    null,
    {},
    'wrong',
    [null, {}, { ...valid, media: null }],
    [{ ...valid, price: { amount: '1', currency: 'CNY' } }],
    [{ ...valid, tags: [null] }],
    [{ ...valid, createdAt: 'bad' }]
  ])('rejects malformed payload %j', (value) => {
    expect(decodeItemCache(value)).toEqual([])
  })
  it('keeps valid legacy items and does not overwrite corrupt stored data', () => {
    const raw = JSON.stringify([{}, valid, null])
    localStorage.setItem('c2c:items:user-published', raw)
    const { result } = renderHook(() => useItemStore())
    expect(result.current.hydrated).toBe(true)
    expect(result.current.userItems.map((i) => i.id)).toEqual(['local_valid'])
    expect(result.current.items).toHaveLength(items.length + 1)
    expect(localStorage.getItem('c2c:items:user-published')).toBe(raw)
  })
  it('validates storage events and permits publishing after recovery', () => {
    const { result } = renderHook(() => useItemStore())
    act(() => {
      localStorage.setItem('c2c:items:user-published', '[{}]')
      window.dispatchEvent(new StorageEvent('storage', { key: 'c2c:items:user-published' }))
    })
    expect(result.current.userItems).toEqual([])
    act(() => result.current.add(valid))
    expect(result.current.userItems.map((i) => i.id)).toEqual(['local_valid'])
  })
  it('validates same-tab notifications instead of trusting event data', () => {
    const { result } = renderHook(() => useItemStore())
    act(() => {
      localStorage.setItem('c2c:items:user-published', '[{}]')
      window.dispatchEvent(
        new CustomEvent('c2c:local-storage-change', {
          detail: { key: 'c2c:items:user-published', value: [{}] }
        })
      )
    })
    expect(result.current.items).toHaveLength(items.length)
  })
})
