// useItemStore — 商品（静态 mock + 用户发布合并）
'use client'

import { create } from 'zustand'
import { items as staticItems } from '@/lib/mock-data'
import { useLocalStorage } from '@/hooks/use-local-storage'
import type { Item } from '@/types'

interface ItemState {
  staticItems: Item[]
  userItems: Item[]
  all: () => Item[]
  add: (item: Item) => void
}

export function useItemStore() {
  const [userItems, setUserItems] = useLocalStorage<Item[]>('c2c:items:user-published', [])

  const add = (item: Item) => {
    setUserItems([...userItems, item])
  }

  return {
    staticItems,
    userItems,
    all: () => [...userItems, ...staticItems],
    add
  }
}

// Re-export zustand create for stores that need full create
export { create }