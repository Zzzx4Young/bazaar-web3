'use client'

import { Heart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ItemGrid } from '@/components/home/item-grid'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Link } from '@/i18n/routing'
import { findItem, sellers } from '@/lib/mock-data'
import { useFavoriteStore } from '@/stores/use-favorite-store'

// Force dynamic rendering — favorites are stored in localStorage and only
// available client-side. Prerendering at build time would always show the
// empty state.
export const dynamic = 'force-dynamic'

export default function FavoritesPage() {
  const t = useTranslations('emptyState.favorites')
  const tCommon = useTranslations('common')
  const { favorites } = useFavoriteStore()
  const favoritedItems = favorites
    .map(id => findItem(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
  const sellerMap = new Map(sellers.map(s => [s.id, s]))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">我的收藏 ({favoritedItems.length})</h1>

      {favoritedItems.length === 0 ? (
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
        <ItemGrid items={favoritedItems} sellers={sellerMap} />
      )}
    </div>
  )
}
