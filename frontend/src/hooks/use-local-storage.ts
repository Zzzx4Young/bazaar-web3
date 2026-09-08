'use client'

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

const CHANGE_EVENT = 'c2c:local-storage-change'

// Hydrate after mounting; synchronize this tab via an event and other tabs via storage.
export function useLocalStorage<T>(key: string, initial: T): [T, (v: SetStateAction<T>) => void, boolean] {
  const initialRef = useRef(initial)
  const valueRef = useRef(initial)
  const [value, setValue] = useState(initial)
  const [hydrated, setHydrated] = useState(false)

  const read = useCallback((): T => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initialRef.current
      const parsed = JSON.parse(raw)
      if (Array.isArray(initialRef.current) && !Array.isArray(parsed)) return initialRef.current
      return parsed as T
    } catch {
      return initialRef.current
    }
  }, [key])

  useEffect(() => {
    const update = (next: T) => {
      valueRef.current = next
      setValue(next)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) update(read())
    }
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T }>).detail
      if (detail.key === key) update(detail.value)
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(CHANGE_EVENT, onChange)
    update(read())
    setHydrated(true)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(CHANGE_EVENT, onChange)
    }
  }, [key, read])

  const set = useCallback((action: SetStateAction<T>) => {
    const previous = valueRef.current
    const next = typeof action === 'function' ? (action as (v: T) => T)(previous) : action
    // Callers can show an error when the browser cannot persist the change.
    window.localStorage.setItem(key, JSON.stringify(next))
    valueRef.current = next
    setValue(next)
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, value: next } }))
  }, [key])

  return [value, set, hydrated]
}
