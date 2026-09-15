'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { ItemGrid } from '@/components/home/item-grid'
import { useBackendListings } from '@/hooks/use-backend-listings'

export default function SellerPage({ params }: { params: { id: string } }) {
  const backend = useBackendListings(new URLSearchParams({ sort: 'newest', limit: '50' }))
  if (backend.loading) return <p role="status">正在从服务端加载卖家商品…</p>
  if (backend.error)
    return (
      <p role="alert" className="text-destructive">
        卖家商品加载失败：{backend.error}
      </p>
    )
  const sellerItems = backend.items.filter((item) => item.sellerId === params.id)
  const displayName = sellerItems[0]?.sellerDisplayName

  if (!displayName)
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          当前没有可展示的卖家商品。
        </CardContent>
      </Card>
    )

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <Avatar className="h-16 w-16">
            <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Alpha 预置账户 · {sellerItems.length} 件公开在售商品
            </p>
          </div>
        </CardContent>
      </Card>
      <ItemGrid items={sellerItems} title="在售商品" />
    </div>
  )
}
