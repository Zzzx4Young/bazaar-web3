'use client'

import { create } from 'zustand'
import {
  backendErrorCode,
  backendErrorMessage,
  login,
  logout,
  refreshSession,
  type AuthView
} from '@/lib/backend-api'

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unavailable'

interface AuthState {
  status: AuthStatus
  view: AuthView | null
  error: string | null
  restore: () => Promise<void>
  signIn: (loginName: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
  invalidate: (token: string) => void
}

export const useAuthStore = create<AuthState>((set, get) => {
  let generation = 0
  let restoring: Promise<void> | null = null
  return {
    status: 'loading',
    view: null,
    error: null,
    invalidate: token => {
      if (get().view?.csrfToken !== token) return
      ++generation
      set({ status: 'anonymous', view: null, error: 'UNAUTHENTICATED' })
    },
    restore: () => {
      if (restoring) return restoring
      const current = generation
      restoring = (async () => {
        try {
          const view = await refreshSession()
          if (current === generation) set({ status: 'authenticated', view, error: null })
        } catch (error) {
          if (current !== generation) return
          const code = backendErrorCode(error)
          set({
            status: code === 'UNAUTHENTICATED' ? 'anonymous' : 'unavailable',
            view: null,
            error: code === 'UNAUTHENTICATED' ? null : backendErrorMessage(error)
          })
        } finally {
          restoring = null
        }
      })()
      return restoring
    },
    signIn: async (loginName, password) => {
      const current = ++generation
      try {
        const view = await login(loginName, password)
        if (current !== generation) return false
        set({ status: 'authenticated', view, error: null })
        return true
      } catch (error) {
        if (current !== generation) return false
        set({ status: 'anonymous', view: null, error: backendErrorMessage(error) })
        return false
      }
    },
    signOut: async () => {
      const current = ++generation
      const csrfToken = get().view?.csrfToken
      if (!csrfToken) {
        set({ status: 'anonymous', view: null, error: null })
        return
      }
      try {
        await logout(csrfToken)
        if (current === generation) set({ status: 'anonymous', view: null, error: null })
      } catch (error) {
        if (current !== generation) return
        const code = backendErrorCode(error)
        if (code === 'UNAUTHENTICATED') set({ status: 'anonymous', view: null, error: null })
        else set({ error: backendErrorMessage(error) })
      }
    }
  }
})
