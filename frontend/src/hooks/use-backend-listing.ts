'use client'

import { useEffect, useState } from 'react'
import type { Item } from '@/types'
import { backendPost, toItem, type BackendListing } from '@/lib/backend-api'

export function useBackendListing(id: string) {
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    backendPost<BackendListing>(`/listings/${encodeURIComponent(id)}/detail`)
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
