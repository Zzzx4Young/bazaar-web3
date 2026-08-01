// localStorage hook（SSR 安全）
'use client'

import { useState, useEffect } from 'react'

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) {
        setValue(JSON.parse(raw) as T)
      }
    } catch {
      // ignore parse errors
    }
  }, [key])

  const set = (v: T) => {
    setValue(v)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(key, JSON.stringify(v))
      } catch {
        // quota exceeded — ignore
      }
    }
  }

  return [value, set]
}