// 订单表格
import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatPrice, formatDate } from '@/lib/format'
import { orderStatusLabel, orderStatusVariant } from '@/lib/order-status'
import { findItem } from '@/lib/mock-data'
import type { Order } from '@/types'

interface OrderTableProps {
  orders: Order[]
  emptyText?: string
}

export function OrderTable({ orders, emptyText = '暂无订单' }: OrderTableProps) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orders.map(order => {
        const item = findItem(order.itemId)
        return (
          <Card key={order.id}>
            <CardContent className="flex items-center gap-4 p-4">
              <Link
                href={item ? `/listing/${item.id}` : '#'}
                className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-muted"
              >
                {item?.media[0] && (
                  <Image
                    src={item.media[0].url}
                    alt={item.title}
                    fill
                    sizes="64px"
                    className="object-cover"
                    unoptimized
                  />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={item ? `/listing/${item.id}` : '#'}
                  className="line-clamp-1 font-medium hover:underline"
                >
                  {item?.title ?? `已下架商品 (${order.itemId})`}
                </Link>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={orderStatusVariant(order.status)}>
                    {orderStatusLabel(order.status)}
                  </Badge>
                  <span>{formatDate(order.createdAt)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-primary">
                  {formatPrice(order.amount.amount, order.amount.currency)}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}