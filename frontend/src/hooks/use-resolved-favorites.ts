'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { subscribeResolvedFavorites } from '@/lib/resolved-favorites'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { useFavoriteStore } from '@/stores/use-favorite-store'
import type { Item } from '@/types'

type Result = { items: Item[]; loading: boolean; error: string | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function useResolvedFavorites(): Result {
  const locale = useLocale()
  const { favorites } = useFavoriteStore()
  const ids = [...new Set(favorites.filter((id) => typeof id === 'string' && uuid.test(id)))]
  const key = ids.join(',')
  const stateKey = `${locale}:${key}`
  const [state, setState] = useState<Result & { key: string }>({
    key: '',
    items: [],
    loading: true,
    error: null
  })

  useEffect(() => {
    let cancelled = false
    if (!ids.length) {
      setState({ key: stateKey, items: [], loading: false, error: null })
      return
    }
    setState({ key: stateKey, items: [], loading: true, error: null })
    const resolution = subscribeResolvedFavorites(ids)
    resolution.promise
      .then((items) => {
        if (!cancelled)
          setState({
            key: stateKey,
            items,
            loading: false,
            error: null
          })
      })
      .catch((error) => {
        if (!cancelled)
          setState({
            key: stateKey,
            items: [],
            loading: false,
            error: apiErrorCopy(error, locale)
          })
      })
    return () => {
      cancelled = true
      resolution.release()
    }
    // The stable key represents the ordered, deduplicated IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locale])

  if (state.key !== stateKey) return { items: [], loading: true, error: null }
  return state
}
