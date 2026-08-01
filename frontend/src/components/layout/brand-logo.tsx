'use client'

import { Link } from '@/i18n/routing'
import { useTheme } from './theme-provider'
import { cn } from '@/lib/utils'

/**
 * Brand logo. Uses a gradient text fill in dark mode and a solid foreground
 * in light mode, so the mark stands out on both backgrounds without needing
 * a separate raster logo.
 */
export function BrandLogo() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Link
      href="/"
      aria-label="Bazaar Web3 — go to home"
      className={cn(
        'font-extrabold tracking-tight text-lg',
        isDark
          ? 'bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-emerald-300 bg-clip-text text-transparent'
          : 'text-foreground'
      )}
    >
      Bazaar Web3
    </Link>
  )
}