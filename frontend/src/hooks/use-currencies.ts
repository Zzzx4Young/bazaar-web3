'use client'

import { useCallback, useEffect, useState } from 'react'
import { backendPost } from '@/lib/backend-api'
import type { Currency } from '@/types'

export interface CurrencyOption {
  code: Currency
  scale: number
}

export function useCurrencies() {
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const retry = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    backendPost<CurrencyOption[]>('/currencies')
      .then((options) => {
        if (
          !Array.isArray(options) ||
          options.length === 0 ||
          options.some(
            (option) =>
              typeof option?.code !== 'string' ||
              !/^[A-Z]{2,5}$/.test(option.code) ||
              !Number.isInteger(option.scale) ||
              option.scale < 0 ||
              option.scale > 18
          )
        )
          throw new Error('INVALID_CURRENCY_CATALOG')
        if (!cancelled) setCurrencies(options)
      })
      .catch((cause) => {
        if (!cancelled) {
          setCurrencies([])
          setError(cause instanceof Error ? cause.message : 'NETWORK_ERROR')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  return { currencies, loading, error, retry }
}
