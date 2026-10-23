// 商品卡片 — 显示主图,失败时降级到 PlaceholderArt
'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useLocale } from 'next-intl'
import { Link } from '@/i18n/routing'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PlaceholderArt } from '@/components/home/placeholder-art'
import { formatPrice } from '@/lib/format'
import { marketplaceCategories } from '@/lib/categories'
import type { Item, Seller } from '@/types'

interface ItemCardProps {
  item: Item
  seller?: Seller
}

export function ItemCard({ item, seller }: ItemCardProps) {
  const locale = useLocale()
  const cover = item.media[0]
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null)
  const category = marketplaceCategories.find((entry) => entry.id === item.primaryCategory)

  // No cover media at all → jump straight to placeholder.
  const showPlaceholder = !cover || failedCoverUrl === cover.url

  return (
    <Link href={`/listing/${item.id}`} className="group block h-full rounded-lg transition-transform duration-200 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transform-none">
      <Card className="flex h-full flex-col overflow-hidden transition-[border-color,box-shadow] duration-200 group-hover:border-primary/40 group-hover:shadow-lg">
        <div
          className="relative aspect-[1.16] w-full overflow-hidden bg-muted"
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
              className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
              onError={() => setFailedCoverUrl(cover!.url)}
              unoptimized
            />
          )}
          {!showPlaceholder && item.illustrativeImage && (
            <Badge className="absolute bottom-2 left-2 bg-black/75 text-white hover:bg-black/75">
              {locale === 'zh-CN' ? '示意图' : 'Illustration'}
            </Badge>
          )}
          {item.category === 'digital' && (
            <Badge
              className="absolute right-2 top-2 bg-card/90 text-card-foreground hover:bg-card/90"
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
        <CardContent className="flex flex-1 flex-col p-4">
          <span className="market-eyebrow text-[10px]">{category ? (locale === 'en' ? category.id.replaceAll('_', ' ') : category.label) : item.category}</span>
          <div className="mt-2 line-clamp-2 min-h-[2.7em] text-sm font-semibold leading-snug" title={item.title}>
            {item.title}
          </div>
          <div className="mt-auto flex flex-wrap items-baseline gap-1 pt-4">
            <span className="text-lg font-bold tracking-tight text-foreground">
              {formatPrice(item.price.exactAmount ?? item.price.amount, item.price.currency)}
            </span>
            {item.originalPrice && item.originalPrice.amount > item.price.amount && (
              <span className="text-xs text-muted-foreground line-through">
                {formatPrice(item.originalPrice.amount, item.originalPrice.currency)}
              </span>
            )}
          </div>
          {(item.sellerDisplayName || seller) && (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {item.sellerDisplayName ?? seller?.displayName}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
