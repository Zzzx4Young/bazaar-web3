// 商品卡片 — 显示主图,失败时降级到 PlaceholderArt
'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Link } from '@/i18n/routing'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PlaceholderArt } from '@/components/home/placeholder-art'
import { formatPrice } from '@/lib/format'
import type { Item, Seller } from '@/types'

interface ItemCardProps {
  item: Item
  seller?: Seller
}

/**
 * Mock-data projects: we use placehold.co URLs which look ugly against our
 * actual visual style. When the env var is set (default in this prototype),
 * ItemCard skips the network image and renders our category-themed
 * PlaceholderArt directly. To enable real images again, unset
 * NEXT_PUBLIC_USE_PLACEHOLDER or set it to "0".
 */
const USE_PLACEHOLDER =
  process.env.NEXT_PUBLIC_USE_PLACEHOLDER !== '0'

export function ItemCard({ item, seller }: ItemCardProps) {
  const cover = item.media[0]
  const [imgFailed, setImgFailed] = useState(false)

  // No cover media at all → jump straight to placeholder.
  const showPlaceholder = USE_PLACEHOLDER || !cover || imgFailed

  return (
    <Link href={`/listing/${item.id}`} className="block h-full transition hover:opacity-90">
      <Card className="flex h-full flex-col overflow-hidden">
        <div
          className="relative aspect-square w-full overflow-hidden"
          data-testid="item-card-cover"
        >
          {showPlaceholder ? (
            <PlaceholderArt item={item} />
          ) : (
            <Image
              src={cover!.url}
              alt={cover!.alt ?? item.title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              className="object-cover"
              onError={() => setImgFailed(true)}
              unoptimized
            />
          )}
          {item.category === 'digital' && (
            <Badge
              className="absolute right-2 top-2 bg-white/90 text-foreground hover:bg-white"
              variant="secondary"
            >
              数字
            </Badge>
          )}
          {item.originalPrice && item.originalPrice.amount > item.price.amount && (
            <Badge className="absolute left-2 top-2" variant="destructive">
              降价
            </Badge>
          )}
        </div>
        <CardContent className="flex flex-1 flex-col p-3">
          <div className="line-clamp-2 text-sm font-medium" title={item.title}>
            {item.title}
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-lg font-bold text-primary">
              {formatPrice(item.price.amount, item.price.currency)}
            </span>
            {item.originalPrice && item.originalPrice.amount > item.price.amount && (
              <span className="text-xs text-muted-foreground line-through">
                {formatPrice(item.originalPrice.amount, item.originalPrice.currency)}
              </span>
            )}
          </div>
          {seller && (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {seller.displayName}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
