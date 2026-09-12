'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/use-auth-store'

export function AuthSession() {
  const restore = useAuthStore(state => state.restore)

  useEffect(() => {
    void restore()
  }, [restore])

  return null
}
