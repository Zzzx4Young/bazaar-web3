// useFavoriteStore — 收藏
'use client'

import { useState } from 'react'
import { useLocalStorage } from '@/hooks/use-local-storage'

export function useFavoriteStore() {
  const [favorites, setFavorites] = useLocalStorage<string[]>('c2c:user:favorites', [])

  const [error, setError] = useState<string | null>(null)

  const toggle = (itemId: string) => {
    try {
    setFavorites(
      previous => previous.includes(itemId)
        ? previous.filter(id => id !== itemId)
        : [...previous, itemId]
    )
    setError(null)
    } catch {
      setError('无法保存收藏，请检查浏览器存储空间或权限。')
    }
  }

  const isFavorite = (itemId: string) => favorites.includes(itemId)

  return { favorites, toggle, isFavorite, error }
}