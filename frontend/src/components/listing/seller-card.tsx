// 卖家卡片
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Star } from 'lucide-react'
import type { Seller } from '@/types'

interface SellerCardProps {
  seller: Seller
}

export function SellerCard({ seller }: SellerCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Avatar className="h-12 w-12">
          <AvatarImage
            src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${seller.avatarSeed}`}
            alt={seller.displayName}
          />
          <AvatarFallback>{seller.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <Link href={`/seller/${seller.id}`} className="block truncate font-medium hover:underline">
            {seller.displayName}
          </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              {seller.rating.toFixed(1)}
            </span>
            <span>· {seller.ratingCount} 评价</span>
            <span>· {seller.completedOrders} 单成交</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}