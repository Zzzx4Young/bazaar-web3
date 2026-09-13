'use client'
import { useEffect, useRef, useState } from 'react'
import { BackendError, backendErrorCode } from '@/lib/backend-api'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'

// The UI freezes both payload and key after an unknown outcome. Success callbacks
// (including refresh failures) must never turn a committed action into a new request.
export function useOrderCommand() {
  const accountId = useAuthStore((state) => state.view?.account.id)
  const storageKey = `bazaar:alpha-pending-command:${accountId ?? 'anonymous'}`
  const pending = useRef<{ path: string; body: unknown; key: string } | null>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string>()
  const [retryPath, setRetryPath] = useState<string>()
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (!saved) return
      pending.current = JSON.parse(saved)
      setRetryPath(pending.current?.path)
      setUncertain(true)
    } catch {
      sessionStorage.removeItem(storageKey)
    }
  }, [storageKey])
  async function run(path: string, body: unknown): Promise<{ orderId: string } | undefined> {
    if (busyRef.current) return
    const frozenBody = JSON.parse(JSON.stringify(body))
    if (
      pending.current &&
      (pending.current.path !== path ||
        JSON.stringify(pending.current.body) !== JSON.stringify(frozenBody))
    ) {
      setError('RETRY_PENDING_COMMAND')
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    const command = pending.current ?? {
      path,
      body: frozenBody,
      key: crypto.randomUUID()
    }
    pending.current = command
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command))
    } catch {
      // The in-memory command still protects retries during this page lifetime.
    }
    try {
      const result = await authenticatedPost<{ orderId: string }>(
        command.path,
        command.body,
        command.key
      )
      pending.current = null
      sessionStorage.removeItem(storageKey)
      setRetryPath(undefined)
      setUncertain(false)
      return result
    } catch (failure) {
      const unknown = !(
        failure instanceof BackendError &&
        failure.status >= 400 &&
        failure.status < 500
      )
      if (!unknown) {
        pending.current = null
        sessionStorage.removeItem(storageKey)
        setRetryPath(undefined)
      } else setRetryPath(command.path)
      setUncertain(unknown)
      setError(backendErrorCode(failure))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const retry = () =>
    pending.current ? run(pending.current.path, pending.current.body) : Promise.resolve(undefined)
  return { run, retry, busy, uncertain, error, retryPath }
}
