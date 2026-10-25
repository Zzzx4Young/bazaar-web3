'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import type { Item } from '@/types'
import { fetchListingDetail, toItem } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'

export function useBackendListing(id: string) {
  const locale = useLocale()
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
        if (!cancelled) setError(apiErrorCopy(error, locale))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, locale])
  return { item, loading, error }
}
