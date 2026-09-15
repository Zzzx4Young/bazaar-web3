'use client'

import { Heart } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { ItemGrid } from '@/components/home/item-grid'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Link } from '@/i18n/routing'
import { useBackendListings } from '@/hooks/use-backend-listings'
import { useFavoriteStore } from '@/stores/use-favorite-store'

export const dynamic = 'force-dynamic'

export default function FavoritesPage() {
  const t = useTranslations('emptyState.favorites')
  const tCommon = useTranslations('common')
  const { favorites, reconcile } = useFavoriteStore()
  const backend = useBackendListings(new URLSearchParams({ sort: 'newest', limit: '50' }))
  const favoriteIds = new Set(favorites)
  const items = backend.items.filter((item) => favoriteIds.has(item.id))

  useEffect(() => {
    if (!backend.loading && !backend.error && !backend.hasMore) {
      reconcile(new Set(backend.items.map((item) => item.id)))
    }
  }, [backend.error, backend.hasMore, backend.items, backend.loading, reconcile])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">我的收藏 ({items.length})</h1>
      {backend.loading ? (
        <p role="status">正在从服务端加载收藏商品…</p>
      ) : backend.error ? (
        <p role="alert" className="text-destructive">
          收藏商品加载失败：{backend.error}
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
