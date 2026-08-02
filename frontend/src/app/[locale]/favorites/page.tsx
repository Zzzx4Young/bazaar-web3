'use client'

import { ItemGrid } from '@/components/home/item-grid'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Link } from '@/i18n/routing'
import { findItem, items, sellers } from '@/lib/mock-data'
import { useFavoriteStore } from '@/stores/use-favorite-store'

// Force dynamic rendering — favorites are stored in localStorage and only
// available client-side. Prerendering at build time would always show the
// empty state.
export const dynamic = 'force-dynamic'

export default function FavoritesPage() {
  const { favorites } = useFavoriteStore()
  const favoritedItems = favorites
    .map(id => findItem(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
  const sellerMap = new Map(sellers.map(s => [s.id, s]))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">我的收藏 ({favoritedItems.length})</h1>

      {favoritedItems.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              还没有收藏任何商品
            </p>
            <Button asChild className="mt-4">
              <Link href="/explore">去探索</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ItemGrid items={favoritedItems} sellers={sellerMap} />
      )}
    </div>
  )
}