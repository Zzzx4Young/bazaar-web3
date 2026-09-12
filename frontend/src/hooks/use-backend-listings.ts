'use client'
import { useEffect, useState } from 'react'
import type { Item } from '@/types'
import { fetchListings, toItem } from '@/lib/backend-api'
export function useBackendListings(params: URLSearchParams) {
  const [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null)
  const query = params.toString()
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchListings(new URLSearchParams(query))
      .then((page) => {
        if (!cancelled) setItems(page.items.map(toItem))
      })
      .catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'NETWORK_ERROR')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])
  return { items, loading, error }
}
