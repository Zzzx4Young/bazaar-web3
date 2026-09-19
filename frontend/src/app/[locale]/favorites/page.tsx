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
  const { items, loading, error } = useResolvedFavorites()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">我的收藏 ({items.length})</h1>
      {loading ? (
        <p role="status">正在从服务端加载收藏商品…</p>
      ) : error ? (
        <p role="alert" className="text-destructive">
          收藏商品加载失败：{error}
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
