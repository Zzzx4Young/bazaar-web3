'use client'

import { create } from 'zustand'
import { backendErrorCode, login, logout, refreshSession, type AuthView } from '@/lib/backend-api'

type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

interface AuthState {
  status: AuthStatus
  view: AuthView | null
  error: string | null
  restore: () => Promise<void>
  signIn: (loginName: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  view: null,
  error: null,
  restore: async () => {
    try {
      const view = await refreshSession()
      set({ status: 'authenticated', view, error: null })
    } catch {
      set({ status: 'anonymous', view: null, error: null })
    }
  },
  signIn: async (loginName, password) => {
    try {
      const view = await login(loginName, password)
      set({ status: 'authenticated', view, error: null })
      return true
    } catch (error) {
      set({ status: 'anonymous', view: null, error: backendErrorCode(error) })
      return false
    }
  },
  signOut: async () => {
    const csrfToken = get().view?.csrfToken
    if (!csrfToken) {
      set({ status: 'anonymous', view: null, error: null })
      return
    }
    try {
      await logout(csrfToken)
    } finally {
      set({ status: 'anonymous', view: null, error: null })
    }
  }
}))
