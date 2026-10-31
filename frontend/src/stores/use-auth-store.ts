'use client'

import { create } from 'zustand'
import {
  backendErrorCode,
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
  errorRequestId: string | null
  restore: () => Promise<void>
  signIn: (loginName: string, password: string) => Promise<boolean>
  acceptView: (view: AuthView) => void
  signOut: () => Promise<void>
  invalidate: (token: string) => void
}

export const useAuthStore = create<AuthState>((set, get) => {
  let generation = 0
  let restoring: Promise<void> | null = null
  const correlationId = (error: unknown) => {
    if (!error || typeof error !== 'object' || !('requestId' in error)) return null
    const id = error.requestId
    return typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : null
  }
  return {
    status: 'loading',
    view: null,
    error: null,
    errorRequestId: null,
    invalidate: token => {
      if (get().view?.csrfToken !== token) return
      ++generation
      set({ status: 'anonymous', view: null, error: 'UNAUTHENTICATED', errorRequestId: null })
    },
    restore: () => {
      if (restoring) return restoring
      const current = generation
      restoring = (async () => {
        try {
          const view = await refreshSession()
          if (current === generation)
            set({ status: 'authenticated', view, error: null, errorRequestId: null })
        } catch (error) {
          if (current !== generation) return
          const code = backendErrorCode(error)
          set({
            status: code === 'UNAUTHENTICATED' ? 'anonymous' : 'unavailable',
            view: null,
            error: code === 'UNAUTHENTICATED' ? null : code,
            errorRequestId: code === 'UNAUTHENTICATED' ? null : correlationId(error)
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
        set({ status: 'authenticated', view, error: null, errorRequestId: null })
        return true
      } catch (error) {
        if (current !== generation) return false
        set({
          status: 'anonymous',
          view: null,
          error: backendErrorCode(error),
          errorRequestId: correlationId(error)
        })
        return false
      }
    },
    acceptView: view => {
      ++generation
      set({ status: 'authenticated', view, error: null, errorRequestId: null })
    },
    signOut: async () => {
      const current = ++generation
      const csrfToken = get().view?.csrfToken
      if (!csrfToken) {
        set({ status: 'anonymous', view: null, error: null, errorRequestId: null })
        return
      }
      try {
        await logout(csrfToken)
        if (current === generation)
          set({ status: 'anonymous', view: null, error: null, errorRequestId: null })
      } catch (error) {
        if (current !== generation) return
        const code = backendErrorCode(error)
        if (code === 'UNAUTHENTICATED')
          set({ status: 'anonymous', view: null, error: null, errorRequestId: null })
        else set({ error: code, errorRequestId: correlationId(error) })
      }
    }
  }
})
