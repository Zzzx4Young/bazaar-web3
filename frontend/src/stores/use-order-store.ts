// useOrderStore — 订单（mock + localStorage 合并）
'use client'

import { create } from 'zustand'
import { orders as staticOrders } from '@/lib/mock-data'
import { useLocalStorage } from '@/hooks/use-local-storage'
import type { Order, OrderStatus } from '@/types'

interface OrderState {
  staticOrders: Order[]
  userOrders: Order[]
  all: () => Order[]
  create: (order: Omit<Order, 'id' | 'createdAt'>) => Order
  updateStatus: (orderId: string, status: OrderStatus) => void
  byBuyer: (buyerId: string) => Order[]
  bySeller: (sellerId: string) => Order[]
}

export function useOrderStore() {
  const [userOrders, setUserOrders] = useLocalStorage<Order[]>('c2c:orders', [])

  const create = (input: Omit<Order, 'id' | 'createdAt'>): Order => {
    const order: Order = {
      ...input,
      id: `order_user_${Date.now()}`,
      createdAt: new Date().toISOString()
    }
    setUserOrders([order, ...userOrders])
    return order
  }

  const updateStatus = (orderId: string, status: OrderStatus) => {
    setUserOrders(
      userOrders.map(o => (o.id === orderId ? { ...o, status } : o))
    )
  }

  const all = (): Order[] => [...userOrders, ...staticOrders]

  const byBuyer = (buyerId: string) => all().filter(o => o.buyerId === buyerId)
  const bySeller = (sellerId: string) => all().filter(o => o.sellerId === sellerId)

  return {
    staticOrders,
    userOrders,
    all,
    create,
    updateStatus,
    byBuyer,
    bySeller
  }
}

export { create }