'use client'

import { useApiResource } from '@/hooks/use-api-resource'
import type { Delivery, Issue, OrderEvent, Page, Refund, Settlement } from '@/lib/order-api'

export function useOrderHistory(orderId: string) {
  const deliveries = useApiResource<Page<Delivery>>(`/orders/${orderId}/deliveries`, {}, true)
  const issues = useApiResource<Page<Issue>>(`/orders/${orderId}/issues`, {}, true)
  const refunds = useApiResource<Page<Refund>>(`/orders/${orderId}/refunds`, {}, true)
  const settlements = useApiResource<Page<Settlement>>(`/orders/${orderId}/settlements`, {}, true)
  const events = useApiResource<Page<OrderEvent>>(`/orders/${orderId}/events`, {}, true)
  return {
    deliveries,
    issues,
    refunds,
    settlements,
    events,
    reload: () => {
      deliveries.reload()
      issues.reload()
      refunds.reload()
      settlements.reload()
      events.reload()
    }
  }
}

export function OrderHistory({ history }: { history: ReturnType<typeof useOrderHistory> }) {
  const error = [
    history.deliveries,
    history.issues,
    history.refunds,
    history.settlements,
    history.events
  ].find((resource) => resource.error)?.error
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        私有记录加载失败：{error}
      </p>
    )
  return (
    <div className="space-y-4">
      {history.deliveries.data?.items.map((delivery) => (
        <section key={delivery.id} className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">第 {delivery.sequence} 次交付</h2>
          {delivery.kind === 'digital' ? (
            <p>
              <a
                href={delivery.reference}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline"
              >
                打开交付链接
              </a>
              {delivery.accessCode && <> · 提取码：{delivery.accessCode}</>}
            </p>
          ) : (
            <p>
              {delivery.carrier} · {delivery.reference}
            </p>
          )}
        </section>
      ))}
      {!!history.issues.data?.items.length && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">问题记录</h2>
          {history.issues.data.items.map((issue) => (
            <p key={issue.id}>
              {issue.status} · {issue.description}
            </p>
          ))}
        </section>
      )}
      {!!history.refunds.data?.items.length && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">退款记录</h2>
          {history.refunds.data.items.map((refund) => (
            <p key={refund.id}>
              {refund.status}
              {refund.returnOutcome ? ` · ${refund.returnOutcome}` : ''}
            </p>
          ))}
        </section>
      )}
      {!!history.settlements.data?.items.length && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">模拟结算</h2>
          {history.settlements.data.items.map((settlement) => (
            <p key={settlement.id}>
              {settlement.operation} · {settlement.price.amount} {settlement.price.currency}
            </p>
          ))}
        </section>
      )}
      {!!history.events.data?.items.length && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">状态历史</h2>
          {history.events.data.items.map((event) => (
            <p key={event.id}>
              {event.operation} · {event.fromState ?? 'created'} → {event.toState}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
