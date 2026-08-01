'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'c2c:theme'

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): Theme | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw)
    if (parsed === 'light' || parsed === 'dark') return parsed
  } catch {
    // ignore
  }
  return undefined
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
}

function writeStoredTheme(theme: Theme) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme))
  } catch {
    // quota exceeded — ignore
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Track whether we've resolved the initial theme on the client. On the
  // server we render with the safe default ('light') and update on hydration.
  const [theme, setThemeState] = useState<Theme>('light')

  // On mount: resolve stored / system preference, sync DOM, sync state.
  useEffect(() => {
    const stored = readStoredTheme()
    const initial = stored ?? getSystemTheme()
    setThemeState(initial)
    applyTheme(initial)
  }, [])

  // Keep DOM in sync if state changes for any other reason.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    applyTheme(next)
    writeStoredTheme(next)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return ctx
}