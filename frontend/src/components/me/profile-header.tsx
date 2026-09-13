// 个人主页：公开信息 + 在售商品
import { Link } from '@/i18n/routing'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Star } from 'lucide-react'
import { ItemGrid } from '@/components/home/item-grid'
import { findSeller } from '@/lib/mock-data'
import { useItemStore } from '@/stores/use-item-store'
import { useUserStore } from '@/stores/use-user-store'
import { useAuthStore } from '@/stores/use-auth-store'
import type { Seller } from '@/types'

export function ProfileHeader() {
  const user = useUserStore((s) => s.user)
  const auth = useAuthStore()
  const alphaAccount = auth.view?.account
  const sellerId = user.linkedSellerId ?? user.id
  const seller = findSeller(sellerId)
  const { items } = useItemStore()

  const myItems = items.filter((item) => item.sellerId === sellerId && item.status === 'active')
  const sellerMap = new Map<string, Seller>()
  if (seller) sellerMap.set(seller.id, seller)

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row">
          <Avatar className="h-16 w-16 shrink-0">
            <AvatarImage
              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.avatarSeed}`}
              alt={alphaAccount?.displayName ?? user.displayName}
            />
            <AvatarFallback>
              {(alphaAccount?.displayName ?? user.displayName).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="w-full min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{alphaAccount?.displayName ?? user.displayName}</h1>
              <Badge variant="outline">{alphaAccount ? 'Alpha 账户' : 'Demo 用户'}</Badge>
            </div>
            {!alphaAccount && user.walletAddress && (
              <div className="text-xs text-muted-foreground">
                钱包地址：
                <code className="break-all rounded bg-muted px-1 py-0.5">{user.walletAddress}</code>
              </div>
            )}
            {!alphaAccount && seller && (
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
            className="shrink-0 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            发布商品
          </Link>
        </CardContent>
      </Card>

      {!alphaAccount && (
        <ItemGrid
          items={myItems}
          sellers={sellerMap}
          title="📦 Demo 在售商品"
          emptyVariant="noPublished"
        />
      )}
    </div>
  )
}
