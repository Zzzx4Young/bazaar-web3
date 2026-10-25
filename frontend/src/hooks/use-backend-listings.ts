'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import type { Item } from '@/types'
import { fetchListings, toItem } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
export function useBackendListings(params: URLSearchParams) {
  const locale = useLocale()
  const quote = useRef<{ key: string; id: string } | null>(null)
  const [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [hasMore, setHasMore] = useState(false),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1)
  const query = params.toString()
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const request = new URLSearchParams(query)
    const pageNumber = Number(request.get('page') ?? '1')
    request.delete('page')
    const filterKey = request.toString()
    if (pageNumber === 1) quote.current = null
    else if (request.get('sort')?.startsWith('price_') && quote.current?.key === filterKey)
      request.set('quoteId', quote.current.id)
    request.set('page', String(pageNumber))
    fetchListings(request)
      .then((page) => {
        if (!cancelled) {
          if (page.quote && pageNumber === 1) quote.current = { key: filterKey, id: page.quote.id }
          setItems(page.items.map(toItem))
          setHasMore(page.hasMore)
          setTotal(page.total)
          setPage(page.page)
        }
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
  }, [query, locale])
  return { items, loading, error, hasMore, total, page }
}
