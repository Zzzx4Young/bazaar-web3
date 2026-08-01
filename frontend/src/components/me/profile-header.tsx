// 个人主页：公开信息 + 在售商品
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Star } from 'lucide-react'
import { ItemGrid } from '@/components/home/item-grid'
import { findSeller, items } from '@/lib/mock-data'
import { useUserStore } from '@/stores/use-user-store'
import type { Seller } from '@/types'

export function ProfileHeader() {
  const user = useUserStore(s => s.user)
  const seller = findSeller(user.id)

  // 用户作为卖家发布的商品（mock 暂时为空）
  const myItems = items.slice(20, 25)
  const sellerMap = new Map<string, Seller>()
  if (seller) sellerMap.set(user.id, seller)

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-start gap-4 p-6">
          <Avatar className="h-16 w-16">
            <AvatarImage
              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.avatarSeed}`}
              alt={user.displayName}
            />
            <AvatarFallback>{user.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{user.displayName}</h1>
              <Badge variant="outline">普通用户</Badge>
            </div>
            {user.walletAddress && (
              <div className="text-xs text-muted-foreground">
                钱包地址：<code className="rounded bg-muted px-1 py-0.5">{user.walletAddress}</code>
              </div>
            )}
            {seller && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  {seller.rating.toFixed(1)}
                </span>
                <span>· {seller.ratingCount} 评价</span>
                <span>· {seller.completedOrders} 单成交</span>
                <span>· 加入于 {new Date(user.joinedAt).toLocaleDateString('zh-CN')}</span>
              </div>
            )}
          </div>
          <Link
            href="/publish"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            发布商品
          </Link>
        </CardContent>
      </Card>

      <ItemGrid items={myItems} sellers={sellerMap} title="📦 在售商品" />
    </div>
  )
}