// useFavoriteStore — 收藏
'use client'

import { useCallback, useState } from 'react'
import { useLocalStorage } from '@/hooks/use-local-storage'

export function useFavoriteStore() {
  const [favorites, setFavorites] = useLocalStorage<string[]>('c2c:user:favorites', [])

  const [error, setError] = useState<string | null>(null)

  const toggle = useCallback(
    (itemId: string) => {
      try {
        setFavorites((previous) =>
          previous.includes(itemId) ? previous.filter((id) => id !== itemId) : [...previous, itemId]
        )
        setError(null)
      } catch {
        setError('无法保存收藏，请检查浏览器存储空间或权限。')
      }
    },
    [setFavorites]
  )

  const isFavorite = useCallback((itemId: string) => favorites.includes(itemId), [favorites])

  const reconcile = useCallback(
    (validIds: ReadonlySet<string>) => {
      setFavorites((previous) => {
        const next = previous.filter((id) => validIds.has(id))
        return next.length === previous.length ? previous : next
      })
    },
    [setFavorites]
  )

  return { favorites, toggle, isFavorite, reconcile, error }
}
