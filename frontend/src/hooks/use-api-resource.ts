'use client'
import { useEffect, useState } from 'react'
import { backendPost, backendErrorMessage } from '@/lib/backend-api'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'

export function useApiResource<T>(path: string, body: unknown = {}, privateRead = false) {
  const token = useAuthStore((s) => s.view?.csrfToken)
  const [revision, setRevision] = useState(0)
  const json = JSON.stringify(body)
  const key = JSON.stringify([path, json, privateRead ? token : null, revision])
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>()
  useEffect(() => {
    if (privateRead && !token) return
    let active = true
    const request = privateRead ? authenticatedPost<T> : backendPost<T>
    request(path, JSON.parse(json)).then(
      (data) => {
        if (active) setResult({ key, data })
      },
      (error) => {
        if (active) setResult({ key, error: backendErrorMessage(error) })
      }
    )
    return () => {
      active = false
    }
  }, [path, json, token, privateRead, key])
  return {
    data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    loading: result?.key !== key && (!privateRead || !!token),
    reload: () => setRevision((value) => value + 1)
  }
}
