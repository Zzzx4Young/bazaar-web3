'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Item } from '@/types'

export interface CartLine {
  listingId: string
  version: number
  title: string
  type: 'physical' | 'digital'
  amount: string
  currency: string
}

interface CartState {
  ownerId: string | null
  items: CartLine[]
  add: (ownerId: string, item: Item) => void
  remove: (ownerId: string, listingId: string) => void
  clear: (ownerId: string) => void
}

export const useCartStore = create<CartState>()(persist((set) => ({
  ownerId: null,
  items: [],
  add: (ownerId, item) => set((state) => {
    if (!item.backendVersion || item.status !== 'active') return state
    const items = state.ownerId === ownerId ? state.items : []
    if (items.some((line) => line.listingId === item.id) || items.length >= 5) return state
    return {
      ownerId,
      items: [...items, {
        listingId: item.id,
        version: item.backendVersion,
        title: item.title,
        type: item.category,
        amount: String(item.price.exactAmount ?? item.price.amount),
        currency: item.price.currency
      }]
    }
  }),
  remove: (ownerId, listingId) => set((state) => state.ownerId === ownerId
    ? { items: state.items.filter((line) => line.listingId !== listingId) }
    : state),
  clear: (ownerId) => set((state) => state.ownerId === ownerId
    ? { ownerId: null, items: [] }
    : state)
}), {
  name: 'bazaar:cart:v1',
  storage: createJSONStorage(() => sessionStorage),
  skipHydration: true
}))
