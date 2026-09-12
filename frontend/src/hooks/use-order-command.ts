'use client'
import { useRef, useState } from 'react'
import { BackendError, backendErrorCode } from '@/lib/backend-api'
import { authenticatedPost } from '@/lib/authenticated-api'

// The UI freezes both payload and key after an unknown outcome. Success callbacks
// (including refresh failures) must never turn a committed action into a new request.
export function useOrderCommand() {
  const pending = useRef<{ path: string; body: unknown; key: string } | null>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string>()
  async function run(path: string, body: unknown): Promise<{ orderId: string } | undefined> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    const command = pending.current ?? {
      path,
      body: JSON.parse(JSON.stringify(body)),
      key: crypto.randomUUID()
    }
    pending.current = command
    try {
      const result = await authenticatedPost<{ orderId: string }>(
        command.path,
        command.body,
        command.key
      )
      pending.current = null
      setUncertain(false)
      return result
    } catch (failure) {
      const unknown = !(
        failure instanceof BackendError &&
        failure.status >= 400 &&
        failure.status < 500
      )
      if (!unknown) pending.current = null
      setUncertain(unknown)
      setError(backendErrorCode(failure))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return { run, busy, uncertain, error }
}
