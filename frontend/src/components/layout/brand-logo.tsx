'use client'

import { Link } from '@/i18n/routing'

/**
 * The wordmark uses semantic colors so it keeps the same quiet identity in
 * both the light and dark curated-market themes.
 */
export function BrandLogo() {
  return (
    <Link
      href="/"
      aria-label="Bazaar Web3 — go to home"
      className="inline-flex shrink-0 items-center gap-1.5 text-xl font-extrabold tracking-[-0.06em] text-foreground transition-colors hover:text-primary"
    >
      <span>Bazaar Web3</span><span className="text-primary" aria-hidden>✦</span>
    </Link>
  )
}
