// useFavoriteStore — 收藏
'use client'

import { useLocalStorage } from '@/hooks/use-local-storage'

export function useFavoriteStore() {
  const [favorites, setFavorites] = useLocalStorage<string[]>('c2c:user:favorites', [])

  const toggle = (itemId: string) => {
    setFavorites(
      favorites.includes(itemId)
        ? favorites.filter(id => id !== itemId)
        : [...favorites, itemId]
    )
  }

  const isFavorite = (itemId: string) => favorites.includes(itemId)

  return { favorites, toggle, isFavorite }
}