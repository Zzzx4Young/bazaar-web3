'use client'

import { useEffect } from 'react'

export function useVisiblePolling(poll: () => void, enabled: boolean, intervalMs: number) {
  useEffect(() => {
    if (!enabled) return
    let timer: number | undefined
    const stop = () => {
      window.clearTimeout(timer)
      timer = undefined
    }
    const schedule = () => {
      if (document.visibilityState !== 'visible') return
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') poll()
        schedule()
      }, intervalMs)
    }
    const onVisible = () => {
      stop()
      if (document.visibilityState !== 'visible') return
      poll()
      schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [poll, enabled, intervalMs])
}
