// useOrderStore — 订单（mock + localStorage 合并）
'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { orders as staticOrders } from '@/lib/mock-data'
import type { Order, OrderStatus } from '@/types'

interface OrderState {
  userOrders: Order[]
  create: (order: Omit<Order, 'id' | 'createdAt'>) => Order
  updateStatus: (orderId: string, status: OrderStatus) => void
  reset: () => void
}

export const useOrderStore = create<OrderState>()((set, get, api) => {
  // Persist middleware hydrates the existing envelope. Actions commit to storage
  // before using the original Zustand setter (which does not write a second time).
  const commit = (userOrders: Order[]) => {
    window.localStorage.setItem('c2c:orders', JSON.stringify({ state: { userOrders }, version: 0 }))
    set({ userOrders })
  }
  return persist<OrderState>(
    () => ({
      userOrders: [],
      create: (input: Omit<Order, 'id' | 'createdAt'>): Order => {
        const order: Order = {
          ...input,
          id: `order_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString()
        }
        commit([order, ...get().userOrders])
        return order
      },
      updateStatus: (orderId: string, status: OrderStatus) => {
        commit(get().userOrders.map((o) => (o.id === orderId ? { ...o, status } : o)))
      },
      reset: () => commit([])
    }),
    {
      name: 'c2c:orders',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : ({} as Storage)
      )
    }
  )(set, get, api)
})

// Pure selectors — derived from current state + static orders
export const selectAllOrders = (s: OrderState): Order[] => [...s.userOrders, ...staticOrders]

export const selectByBuyer =
  (buyerId: string) =>
  (s: OrderState): Order[] =>
    selectAllOrders(s).filter((o) => o.buyerId === buyerId)

export const selectBySeller =
  (sellerId: string) =>
  (s: OrderState): Order[] =>
    selectAllOrders(s).filter((o) => o.sellerId === sellerId)
