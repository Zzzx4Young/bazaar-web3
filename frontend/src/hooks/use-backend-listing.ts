'use client'

import { useEffect, useState } from 'react'
import type { Item } from '@/types'
import { fetchListingDetail, toItem } from '@/lib/backend-api'

export function useBackendListing(id: string) {
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchListingDetail(id)
      .then((value) => {
        if (!cancelled) setItem(toItem(value))
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
  }, [id])
  return { item, loading, error }
}
