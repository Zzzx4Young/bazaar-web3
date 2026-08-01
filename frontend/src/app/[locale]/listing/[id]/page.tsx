'use client'

import Image from 'next/image'
import { useState } from 'react'
import Link from 'next/link'
import { Heart, Share2, MessageCircle } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MediaCarousel } from '@/components/listing/media-carousel'
import { MarkdownRenderer } from '@/components/listing/markdown-renderer'
import { SellerCard } from '@/components/listing/seller-card'
import { BuyModal } from '@/components/listing/buy-modal'
import { ChatDrawer } from '@/components/listing/chat-drawer'
import { findItem, findSeller, items } from '@/lib/mock-data'
import { formatPrice, formatDate } from '@/lib/format'
import { useFavoriteStore } from '@/stores/use-favorite-store'

interface Props {
  params: { id: string }
}

export default function ListingDetailPage({ params }: Props) {
  const item = findItem(params.id)
  if (!item) notFound()

  const seller = findSeller(item.sellerId)
  const { toggle, isFavorite } = useFavoriteStore()
  const favorited = isFavorite(item.id)

  const [buyOpen, setBuyOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  // 相关推荐（同分类，排除自己）
  const related = items
    .filter(i => i.category === item.category && i.id !== item.id)
    .slice(0, 4)

  return (
    <div className="space-y-6">
      {/* 面包屑 */}
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          首页
        </Link>
        <span className="mx-1">/</span>
        <Link href={`/explore?category=${item.category}`} className="hover:underline">
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
              <Badge variant={item.category === 'digital' ? 'secondary' : 'outline'}>
                {item.category === 'digital' ? '数字资产' : '实物二手'}
              </Badge>
              {item.condition && (
                <Badge variant="outline">
                  {item.condition === 'like_new' ? '99新' : item.condition === 'good' ? '95新' : '其他'}
                </Badge>
              )}
              {item.tags.slice(0, 3).map(t => (
                <Badge key={t} variant="outline" className="text-xs">
                  {t}
                </Badge>
              ))}
            </div>
            <h1 className="mt-3 text-2xl font-bold">{item.title}</h1>
            <div className="mt-2 text-xs text-muted-foreground">
              {formatDate(item.createdAt)}发布 · {item.viewCount} 浏览 · {item.favoriteCount} 收藏
            </div>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-primary">
                  {formatPrice(item.price.amount, item.price.currency)}
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
                <Button className="w-full" size="lg" onClick={() => setBuyOpen(true)}>
                  立即购买
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  size="lg"
                  onClick={() => setChatOpen(true)}
                  disabled={!seller}
                >
                  <MessageCircle className="mr-1 h-4 w-4" />
                  联系卖家
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
                <Button variant="outline" className="w-full" size="lg">
                  <Share2 className="mr-1 h-4 w-4" />
                  分享
                </Button>
              </div>
            </CardContent>
          </Card>

          {seller && <SellerCard seller={seller} />}

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
          {item.category === 'digital' && item.deliveryType && (
            <Card>
              <CardContent className="p-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-muted-foreground">交付方式</div>
                  <div>
                    {item.deliveryType === 'download_link'
                      ? '下载链接'
                      : item.deliveryType === 'license_key'
                        ? '卡密 / 许可证'
                        : item.deliveryType === 'cloud_link'
                          ? '网盘链接'
                          : '账号凭证'}
                  </div>
                  <div className="text-muted-foreground">自动释放</div>
                  <div>付款后 7 天（卖家未交付自动退款）</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* 描述 tabs */}
      <Tabs defaultValue="description">
        <TabsList>
          <TabsTrigger value="description">商品描述</TabsTrigger>
          <TabsTrigger value="related">相关推荐</TabsTrigger>
        </TabsList>
        <TabsContent value="description" className="mt-4">
          <Card>
            <CardContent className="p-6">
              <MarkdownRenderer content={item.description} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="related" className="mt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map(r => (
              <Link key={r.id} href={`/listing/${r.id}`} className="block">
                <Card className="overflow-hidden transition hover:opacity-90">
                  <div className="relative aspect-square bg-muted">
                    {r.media[0] && (
                      <Image
                        src={r.media[0].url}
                        alt={r.title}
                        fill
                        sizes="(max-width: 640px) 50vw, 25vw"
                        className="object-cover"
                        unoptimized
                      />
                    )}
                  </div>
                  <CardContent className="p-2">
                    <div className="line-clamp-2 text-xs">{r.title}</div>
                    <div className="mt-1 text-sm font-bold text-primary">
                      {formatPrice(r.price.amount, r.price.currency)}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <BuyModal item={item} open={buyOpen} onOpenChange={setBuyOpen} />
      <ChatDrawer seller={seller ?? null} open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  )
}