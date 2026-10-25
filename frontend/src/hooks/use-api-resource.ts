'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { backendPost } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'

export function useApiResource<T>(path: string, body: unknown = {}, privateRead = false) {
  const locale = useLocale()
  const token = useAuthStore((s) => s.view?.csrfToken)
  const readToken = privateRead ? token : undefined
  const requestRef = useRef<{
    active: boolean
    inFlight: boolean
    scheduled: boolean
    queued: boolean
  } | null>(null)
  const [revision, setRevision] = useState(0)
  const json = JSON.stringify(body)
  const baseKey = JSON.stringify([path, json, readToken ?? null, locale])
  const key = JSON.stringify([baseKey, revision])
  const [result, setResult] = useState<{
    key: string
    baseKey: string
    data?: T
    error?: string
  }>()
  useEffect(() => {
    if (privateRead && !readToken) return
    const owner = { active: true, inFlight: true, scheduled: false, queued: false }
    const controller = new AbortController()
    requestRef.current = owner
    const request = privateRead
      ? authenticatedPost<T>(path, JSON.parse(json), undefined, controller.signal)
      : backendPost<T>(path, JSON.parse(json), controller.signal)
    request
      .then(
        (data) => {
          if (owner.active) setResult({ key, baseKey, data })
        },
        (error) => {
          if (owner.active) setResult({ key, baseKey, error: apiErrorCopy(error, locale) })
        }
      )
      .finally(() => {
        owner.inFlight = false
        if (owner.active && owner.queued) {
          owner.queued = false
          owner.scheduled = true
          setRevision((value) => value + 1)
        }
      })
    return () => {
      owner.active = false
      controller.abort()
      if (requestRef.current === owner) requestRef.current = null
    }
  }, [path, json, readToken, privateRead, key, baseKey, locale])
  const reload = useCallback(() => {
    const owner = requestRef.current
    if (!owner?.active || owner.scheduled) return
    if (owner.inFlight) {
      owner.queued = true
      return
    }
    owner.scheduled = true
    setRevision((value) => value + 1)
  }, [])
  const poll = useCallback(() => {
    const owner = requestRef.current
    if (owner?.inFlight) return
    reload()
  }, [reload])
  const current = result?.baseKey === baseKey
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : undefined,
    loading: !current && (!privateRead || !!token),
    refreshing: current && result.key !== key,
    reload,
    poll
  }
}
