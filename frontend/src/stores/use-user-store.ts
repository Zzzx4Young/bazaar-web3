// useUserStore — 当前用户（写死 alice，演示用）
'use client'

import { create } from 'zustand'
import { currentUser } from '@/lib/mock-data'
import type { User } from '@/types'

interface UserState {
  user: User
}

export const useUserStore = create<UserState>(() => ({
  user: currentUser
}))