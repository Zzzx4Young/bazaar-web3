'use client'

import { useFavoriteStore } from '@/stores/use-favorite-store'
import { Link, usePathname } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Top-nav link to /favorites with a live count badge. Subscribes to the
 * favorite store so the badge updates on every toggle.
 */
export function FavoritesLink() {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { favorites } = useFavoriteStore()
  const isActive = pathname.startsWith('/favorites')
  const count = favorites.length

  return (
    <Link
      href="/favorites"
      className={cn(
        'inline-flex items-center gap-1.5',
        isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Heart className="h-3.5 w-3.5" />
      <span>{t('favorites')}</span>
      {count > 0 && (
        <span
          className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
          aria-label={`${count} ${t('favorites')}`}
        >
          {count}
        </span>
      )}
    </Link>
  )
}