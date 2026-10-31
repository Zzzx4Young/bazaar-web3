'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { BackendError } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'

type PendingCommand = { path: string; body: unknown; key: string }
type CommandOwner = { accountId: string | undefined; pending: PendingCommand | null; busy: boolean }

function storageKey(accountId: string) {
  return `bazaar:alpha-pending-command:${accountId}`
}

function removeSaved(accountId: string) {
  try {
    sessionStorage.removeItem(storageKey(accountId))
  } catch {
    // Storage availability must not change the known HTTP outcome.
  }
}

function restoreSaved(accountId: string): PendingCommand | null {
  try {
    const saved = sessionStorage.getItem(storageKey(accountId))
    if (!saved) return null
    const value: unknown = JSON.parse(saved)
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'path' in value &&
      typeof value.path === 'string' &&
      value.path.startsWith('/') &&
      'key' in value &&
      typeof value.key === 'string' &&
      value.key.length > 0 &&
      'body' in value
    )
      return { path: value.path, body: value.body, key: value.key }
  } catch {
    // A missing or invalid cache cannot supply a command to another account.
  }
  removeSaved(accountId)
  return null
}

// Freeze payload and key after an unknown outcome. Every account transition
// creates a new owner, so even A -> B -> A cannot accept an obsolete completion.
export function useOrderCommand() {
  const locale = useLocale()
  const accountId = useAuthStore((state) => state.view?.account.id)
  const ownerRef = useRef<CommandOwner>({ accountId, pending: null, busy: false })
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string>()
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null)
  const [retryPath, setRetryPath] = useState<string>()
  useEffect(() => {
    function resetOwner(id: string | undefined) {
      const pending = id ? restoreSaved(id) : null
      ownerRef.current = { accountId: id, pending, busy: false }
      setBusy(false)
      setError(undefined)
      setErrorRequestId(null)
      setRetryPath(pending?.path)
      setUncertain(pending !== null)
    }
    resetOwner(useAuthStore.getState().view?.account.id)
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      const id = state.view?.account.id
      if (id !== previous.view?.account.id) resetOwner(id)
    })
    return () => {
      unsubscribe()
      ownerRef.current = { accountId: undefined, pending: null, busy: false }
    }
  }, [])

  async function run<T extends object = { orderId: string }>(
    path: string,
    body: unknown
  ): Promise<T | undefined> {
    const owner = ownerRef.current
    if (
      !accountId ||
      owner.accountId !== accountId ||
      useAuthStore.getState().view?.account.id !== accountId ||
      owner.busy
    )
      return
    const isCurrent = () =>
      ownerRef.current === owner && useAuthStore.getState().view?.account.id === accountId
    const frozenBody = JSON.parse(JSON.stringify(body))
    if (
      owner.pending &&
      (owner.pending.path !== path ||
        JSON.stringify(owner.pending.body) !== JSON.stringify(frozenBody))
    ) {
      setError(apiErrorCopy('RETRY_PENDING_COMMAND', locale))
      return
    }
    owner.busy = true
    setBusy(true)
    setError(undefined)
    setErrorRequestId(null)
    const command = owner.pending ?? { path, body: frozenBody, key: crypto.randomUUID() }
    owner.pending = command
    try {
      sessionStorage.setItem(storageKey(accountId), JSON.stringify(command))
    } catch {
      // The in-memory command still protects retries during this page lifetime.
    }
    try {
      const result = await authenticatedPost<T>(command.path, command.body, command.key)
      if (!isCurrent()) return
      owner.pending = null
      removeSaved(accountId)
      setRetryPath(undefined)
      setUncertain(false)
      setErrorRequestId(null)
      return result
    } catch (failure) {
      if (!isCurrent()) return
      const unknown = !(
        failure instanceof BackendError &&
        failure.status >= 400 &&
        failure.status < 500
      )
      if (!unknown) {
        owner.pending = null
        removeSaved(accountId)
        setRetryPath(undefined)
      } else setRetryPath(command.path)
      setUncertain(unknown)
      setError(apiErrorCopy(failure, locale))
      const requestId = failure instanceof BackendError ? failure.requestId : null
      setErrorRequestId(
        requestId && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : null
      )
    } finally {
      owner.busy = false
      if (isCurrent()) setBusy(false)
    }
  }
  const retry = <T extends object = { orderId: string }>() => {
    const pending = ownerRef.current.pending
    return pending ? run<T>(pending.path, pending.body) : Promise.resolve(undefined)
  }
  return { run, retry, busy, uncertain, error, errorRequestId, retryPath }
}
