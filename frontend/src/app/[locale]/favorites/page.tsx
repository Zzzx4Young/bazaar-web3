'use client'

import { Heart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ItemGrid } from '@/components/home/item-grid'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Link } from '@/i18n/routing'
import { useResolvedFavorites } from '@/hooks/use-resolved-favorites'

export const dynamic = 'force-dynamic'

export default function FavoritesPage() {
  const t = useTranslations('emptyState.favorites')
  const tCommon = useTranslations('common')
  const tPage = useTranslations('favoritesPage')
  const { items, loading, error } = useResolvedFavorites()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{tPage('title', { count: items.length })}</h1>
      {loading ? (
        <p role="status">{tPage('loading')}</p>
      ) : error ? (
        <p role="alert" className="text-destructive">
          {tPage('loadError', { error })}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t('title')}
          description={t('description')}
          action={
            <Button asChild>
              <Link href="/explore">{tCommon('explore')}</Link>
            </Button>
          }
        />
      ) : (
        <ItemGrid items={items} />
      )}
    </div>
  )
}
