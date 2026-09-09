'use client'

import { useMemo } from 'react'
import { items as staticItems } from '@/lib/mock-data'
import { useLocalStorage } from '@/hooks/use-local-storage'
import type { Item } from '@/types'
import { decodeItemCache } from '@/lib/item-cache'

export function useItemStore() {
  const [userItems, setUserItems, hydrated] = useLocalStorage<Item[]>(
    'c2c:items:user-published',
    [],
    decodeItemCache
  )
  const items = useMemo(() => [...userItems, ...staticItems], [userItems])
  const add = (item: Item) => setUserItems((previous) => [item, ...previous])
  return { staticItems, userItems, items, hydrated, all: () => items, add }
}
