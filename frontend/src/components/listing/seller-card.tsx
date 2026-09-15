// 卖家卡片
import { Link } from '@/i18n/routing'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'

interface SellerCardProps {
  seller: { id: string; displayName: string }
}

export function SellerCard({ seller }: SellerCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Avatar className="h-12 w-12">
          <AvatarFallback>{seller.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <Link
            href={`/seller/${seller.id}`}
            className="block truncate font-medium hover:underline"
          >
            {seller.displayName}
          </Link>
          <div className="text-xs text-muted-foreground">Alpha 预置账户</div>
        </div>
      </CardContent>
    </Card>
  )
}
