'use client'
import { useCallback, useEffect, useState } from 'react'
import { backendPost, backendErrorMessage } from '@/lib/backend-api'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'

export function useApiResource<T>(path: string, body: unknown = {}, privateRead = false) {
  const token = useAuthStore((s) => s.view?.csrfToken)
  const [revision, setRevision] = useState(0)
  const json = JSON.stringify(body)
  const baseKey = JSON.stringify([path, json, privateRead ? token : null])
  const key = JSON.stringify([baseKey, revision])
  const [result, setResult] = useState<{
    key: string
    baseKey: string
    data?: T
    error?: string
  }>()
  useEffect(() => {
    if (privateRead && !token) return
    let active = true
    const request = privateRead ? authenticatedPost<T> : backendPost<T>
    request(path, JSON.parse(json)).then(
      (data) => {
        if (active) setResult({ key, baseKey, data })
      },
      (error) => {
        if (active) setResult({ key, baseKey, error: backendErrorMessage(error) })
      }
    )
    return () => {
      active = false
    }
  }, [path, json, token, privateRead, key, baseKey])
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  const current = result?.baseKey === baseKey
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : undefined,
    loading: !current && (!privateRead || !!token),
    refreshing: current && result.key !== key,
    reload
  }
}
