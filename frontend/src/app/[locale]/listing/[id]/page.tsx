'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { Heart, Share2, MessageCircle } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { MediaCarousel } from '@/components/listing/media-carousel'
import { MarkdownRenderer } from '@/components/listing/markdown-renderer'
import { SellerCard } from '@/components/listing/seller-card'
import { BuyModal } from '@/components/listing/buy-modal'
import { formatPrice, formatDate } from '@/lib/format'
import { useFavoriteStore } from '@/stores/use-favorite-store'
import { useBackendListing } from '@/hooks/use-backend-listing'

interface Props {
  params: { id: string }
}

export default function ListingDetailPage({ params }: Props) {
  const t = useTranslations('common')
  const backend = useBackendListing(params.id)
  const { toggle, isFavorite, error } = useFavoriteStore()
  const [buyOpen, setBuyOpen] = useState(false)
  const item = backend.item
  if (!item && backend.loading) {
    return <p role="status">正在加载商品…</p>
  }
  if (!item) {
    if (backend.error)
      return (
        <p role="alert" className="text-destructive">
          商品加载失败：{backend.error}
        </p>
      )
    notFound()
  }
  const seller = { id: item.sellerId, displayName: item.sellerDisplayName ?? 'Alpha 卖家' }
  const favorited = isFavorite(item.id)

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {/* 面包屑 */}
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          首页
        </Link>
        <span className="mx-1">/</span>
        <Link
          href={item.primaryCategory ? `/explore?category=${item.primaryCategory}` : '/explore'}
          className="hover:underline"
        >
          {item.category === 'physical' ? '实物' : '数字'}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-foreground">{item.title.slice(0, 20)}</span>
      </nav>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 左：媒体轮播 */}
        <MediaCarousel media={item.media} alt={item.title} />

        {/* 右：价格 + 卖家 + 操作 */}
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge data-testid="acceptance-listing-status" variant="outline">
                {item.status === 'active' ? 'ACTIVE' : item.status.toUpperCase()}
              </Badge>
              <Badge variant={item.category === 'digital' ? 'secondary' : 'outline'}>
                {item.category === 'digital' ? '数字资产' : '实物二手'}
              </Badge>
              {item.condition && (
                <Badge variant="outline">
                  {item.condition === 'like_new'
                    ? '99新'
                    : item.condition === 'good'
                      ? '95新'
                      : '其他'}
                </Badge>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-bold">{item.title}</h1>
            <div className="mt-2 text-xs text-muted-foreground">
              {formatDate(item.createdAt)}发布 · 数据来自 Alpha 服务端
            </div>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-primary">
                  {formatPrice(item.price.exactAmount ?? item.price.amount, item.price.currency)}
                </span>
                {item.originalPrice && item.originalPrice.amount > item.price.amount && (
                  <span className="text-sm text-muted-foreground line-through">
                    {formatPrice(item.originalPrice.amount, item.originalPrice.currency)}
                  </span>
                )}
              </div>
              {item.price.fiatEstimate !== undefined && item.price.fiatEstimate > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  ≈ ${item.price.fiatEstimate.toLocaleString()} USD
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button
                  className="w-full"
                  size="lg"
                  disabled={item.status !== 'active'}
                  onClick={() => setBuyOpen(true)}
                >
                  立即购买
                </Button>
                <Button variant="outline" className="w-full" size="lg" disabled>
                  <MessageCircle className="mr-1 h-4 w-4" />
                  联系卖家（未开放）
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  size="lg"
                  onClick={() => toggle(item.id)}
                >
                  <Heart
                    className={`mr-1 h-4 w-4 ${favorited ? 'fill-red-500 text-red-500' : ''}`}
                  />
                  {favorited ? '已收藏' : '收藏'}
                </Button>
                <Button variant="outline" className="w-full" size="lg" disabled>
                  <Share2 className="mr-1 h-4 w-4" />
                  {t('shareUnavailable')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <SellerCard seller={seller} />

          {/* 实物成色 / 数字交付提示 */}
          {item.category === 'physical' && item.condition && (
            <Card>
              <CardContent className="p-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-muted-foreground">物品成色</div>
                  <div>
                    {item.condition === 'like_new'
                      ? '99新'
                      : item.condition === 'good'
                        ? '95新'
                        : item.condition === 'fair'
                          ? '9成新'
                          : item.condition === 'poor'
                            ? '8成新'
                            : '全新'}
                  </div>
                  <div className="text-muted-foreground">交易方式</div>
                  <div>
                    {item.shippingMethod === 'delivery' ? '快递发货 / 同城面交' : '仅限同城面交'}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {item.category === 'digital' && (
            <Card>
              <CardContent className="p-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-muted-foreground">授权说明</div>
                  <div>{item.licenseDescription ?? '以订单交付记录为准'}</div>
                  <div className="text-muted-foreground">内容版本</div>
                  <div>{item.contentVersion ?? '未标注'}</div>
                  <div className="text-muted-foreground">隐私边界</div>
                  <div>交付链接和提取码仅对订单参与方可见</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">商品描述</h2>
        <Card>
          <CardContent className="p-6">
            <MarkdownRenderer content={item.description} />
          </CardContent>
        </Card>
      </section>

      <BuyModal item={item} open={buyOpen} onOpenChange={setBuyOpen} />
    </div>
  )
}
