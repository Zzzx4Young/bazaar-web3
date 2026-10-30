'use client'

import { useAuthStore } from '@/stores/use-auth-store'
import { useApiResource } from '@/hooks/use-api-resource'
import type { OrderSummary, Page } from '@/lib/order-api'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/i18n/routing'
import { useLocale, useTranslations } from 'next-intl'
import { transactionLabel } from '@/lib/transaction-copy'
import { useStoredPage } from '@/hooks/use-stored-page'
import { RecordPagination } from '@/components/ui/record-pagination'
import { paginationPolicy } from '@/lib/pagination'

export function BackendOrders({ role }: { role: 'buyer' | 'seller' }) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('myOrders')
  const auth = useAuthStore()
  const [page, setPage] = useStoredPage(`bazaar:orders:${auth.view?.account.id ?? 'guest'}:${role}`)
  const resource = useApiResource<Page<OrderSummary>>(`/orders/search?role=${role}&page=${page}&limit=${paginationPolicy.defaultLimit}`, {}, true)
  if (auth.status !== 'authenticated')
    return <p className="text-sm text-muted-foreground">{t('signIn')}</p>
  if (resource.loading) return <p role="status">{t('loading')}</p>
  if (resource.error)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {t('loadError', { error: resource.error })}
        </p>
        <Button variant="outline" onClick={resource.reload}>
          {t('retry')}
        </Button>
      </div>
    )
  if (!resource.data) return <p role="status">{t('loading')}</p>
  if (!resource.data.items.length && page === 1)
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>
  return (
    <div className="space-y-3">
      {resource.data.items.map((order) => (
        <article key={order.id} className="rounded-lg border p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-medium">{order.title}</h3>
              <p className="text-sm text-muted-foreground">
                {t(order.type === 'physical' ? 'physical' : 'digital')} · {order.price.amount}{' '}
                {order.price.currency}
              </p>
            </div>
            <span className="shrink-0 text-sm">{transactionLabel(order.status, locale)}</span>
          </div>
          <div className="mt-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 break-all text-xs text-muted-foreground">{t('orderId', { id: order.id })}</p>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => router.push(`/me/orders/${order.id}`)}
            >
              {t('detail')}
            </Button>
          </div>
        </article>
      ))}
      <RecordPagination page={page} limit={resource.data.limit} total={resource.data.total}
        hasMore={resource.data.hasMore} onPageChange={setPage} />
    </div>
  )
}
