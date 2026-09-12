'use client'

import { useAuthStore } from '@/stores/use-auth-store'
import { useApiResource } from '@/hooks/use-api-resource'
import type { OrderSummary, Page } from '@/lib/order-api'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/i18n/routing'

export function BackendOrders({ role }: { role: 'buyer' | 'seller' }) {
  const router = useRouter()
  const auth = useAuthStore()
  const resource = useApiResource<Page<OrderSummary>>(`/orders/search?role=${role}`, {}, true)
  if (auth.status !== 'authenticated')
    return <p className="text-sm text-muted-foreground">请先登录查看真实订单。</p>
  if (resource.loading) return <p role="status">正在加载订单…</p>
  if (resource.error)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          订单加载失败：{resource.error}
        </p>
        <Button variant="outline" onClick={resource.reload}>
          重试
        </Button>
      </div>
    )
  if (!resource.data?.items.length)
    return <p className="text-sm text-muted-foreground">暂无真实订单。</p>
  return (
    <div className="space-y-3">
      {resource.data.items.map((order) => (
        <article key={order.id} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">{order.title}</h3>
              <p className="text-sm text-muted-foreground">
                {order.type === 'physical' ? '实物' : '数字资产'} · {order.price.amount}{' '}
                {order.price.currency}
              </p>
            </div>
            <span className="text-sm">{order.status}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">订单号：{order.id}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(`/me/orders/${order.id}`)}
            >
              查看详情
            </Button>
          </div>
        </article>
      ))}
    </div>
  )
}
