'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useApiResource } from '@/hooks/use-api-resource'
import type { Delivery, Issue, OrderEvent, Page, Refund, Settlement } from '@/lib/order-api'
import { transactionLabel } from '@/lib/transaction-copy'

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
  const tDispute = useTranslations('orderDispute')
  const tHistory = useTranslations('orderHistory')
  const locale = useLocale()
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
        {tHistory('loadError', { error })}
      </p>
    )
  return (
    <div className="space-y-4">
      {history.deliveries.data?.items.map((delivery) => (
        <section key={delivery.id} className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">
            {tHistory('deliveryNumber', { number: delivery.sequence })}
          </h2>
          {delivery.kind === 'digital' ? (
            <p>
              <a
                href={delivery.reference}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline"
              >
                {tHistory('openDelivery')}
              </a>
              {delivery.accessCode && (
                <> · {tHistory('accessCode', { code: delivery.accessCode })}</>
              )}
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
          <h2 className="font-medium">{tHistory('issues')}</h2>
          {history.issues.data.items.map((issue) => (
            <p key={issue.id}>
              {transactionLabel(issue.status, locale)} · {issue.description}
            </p>
          ))}
        </section>
      )}
      {!!history.refunds.data?.items.length && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">{tHistory('refunds')}</h2>
          {history.refunds.data.items.map((refund) => (
            <p key={refund.id}>
              {transactionLabel(refund.status, locale)}
              {refund.returnOutcome ? ` · ${transactionLabel(refund.returnOutcome, locale)}` : ''}
              {refund.resolvedBy ? ` · ${tDispute('adminResolved')}` : ''}
            </p>
          ))}
        </section>
      )}
      {!!history.settlements.data?.items.length && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">{tHistory('settlements')}</h2>
          {history.settlements.data.items.map((settlement) => (
            <p key={settlement.id}>
              {transactionLabel(settlement.operation, locale)} · {settlement.price.amount}{' '}
              {settlement.price.currency}
            </p>
          ))}
        </section>
      )}
      {!!history.events.data?.items.length && (
        <section className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">{tHistory('events')}</h2>
          {history.events.data.items.map((event) => (
            <p key={event.id}>
              {transactionLabel(event.operation, locale)} ·{' '}
              {transactionLabel(event.fromState, locale)} →{' '}
              {transactionLabel(event.toState, locale)}
              {event.note ? ` · ${event.note}` : ''}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
