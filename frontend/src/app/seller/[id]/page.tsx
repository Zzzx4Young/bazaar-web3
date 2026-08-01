// 公开卖家页
import { notFound } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Star } from 'lucide-react'
import { ItemGrid } from '@/components/home/item-grid'
import { findSeller, items, sellers } from '@/lib/mock-data'
import { formatDate } from '@/lib/format'

interface Props {
  params: { id: string }
}

export default function SellerPage({ params }: Props) {
  const seller = findSeller(params.id)
  if (!seller) notFound()

  const sellerItems = items.filter(i => i.sellerId === seller.id)
  const sellerMap = new Map(sellers.map(s => [s.id, s]))

  return (
    <div className="space-y-6">
      {/* 卖家头部 */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
          <Avatar className="h-20 w-20">
            <AvatarImage
              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${seller.avatarSeed}`}
              alt={seller.displayName}
            />
            <AvatarFallback className="text-lg">
              {seller.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{seller.displayName}</h1>
              <Badge variant="secondary">
                {seller.completedOrders > 200
                  ? '金牌卖家'
                  : seller.completedOrders > 100
                    ? '银牌卖家'
                    : '普通卖家'}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                <span className="font-medium text-foreground">{seller.rating.toFixed(1)}</span>
              </span>
              <span>· {seller.ratingCount} 评价</span>
              <span>· {seller.completedOrders} 单成交</span>
              <span>· 加入于 {formatDate(seller.joinedAt)}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              本卖家共发布 {sellerItems.length} 件商品，全部支持平台担保交易。
            </p>
          </div>
          <button
            type="button"
            disabled
            className="rounded-md bg-muted px-4 py-2 text-sm text-muted-foreground"
            title="私聊功能开发中"
          >
            私聊（敬请期待）
          </button>
        </CardContent>
      </Card>

      {/* 商品列表 */}
      <ItemGrid items={sellerItems} sellers={sellerMap} title="📦 在售商品" />
    </div>
  )
}