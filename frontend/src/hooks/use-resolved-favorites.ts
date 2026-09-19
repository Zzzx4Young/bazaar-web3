'use client'

import { useEffect, useState } from 'react'
import { backendPost, toItem, type BackendListing } from '@/lib/backend-api'
import { useFavoriteStore } from '@/stores/use-favorite-store'
import type { Item } from '@/types'

type Result = { items: Item[]; loading: boolean; error: string | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function useResolvedFavorites(): Result {
  const { favorites } = useFavoriteStore()
  const ids = [...new Set(favorites.filter((id) => typeof id === 'string' && uuid.test(id)))]
  const key = ids.join(',')
  const [state, setState] = useState<Result & { key: string }>({
    key: '', items: [], loading: true, error: null
  })

  useEffect(() => {
    let cancelled = false
    if (!ids.length) {
      setState({ key, items: [], loading: false, error: null })
      return
    }
    setState({ key, items: [], loading: true, error: null })
    const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
      ids.slice(index * 100, (index + 1) * 100)
    )
    Promise.all(batches.map((batch) =>
      backendPost<{ items: BackendListing[]; total: number }>('/listings/favorites/resolve', { ids: batch })
    ))
      .then((pages) => {
        if (!cancelled) setState({
          key, items: pages.flatMap((page) => page.items.map(toItem)), loading: false, error: null
        })
      })
      .catch((error) => {
        if (!cancelled) setState({
          key, items: [], loading: false,
          error: error instanceof Error ? error.message : 'NETWORK_ERROR'
        })
      })
    return () => { cancelled = true }
  // The stable key represents the ordered, deduplicated IDs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (state.key !== key) return { items: [], loading: true, error: null }
  return state
}
