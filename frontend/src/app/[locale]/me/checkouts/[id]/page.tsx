'use client'

import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { transactionLabel } from '@/lib/transaction-copy'
import { Link } from '@/i18n/routing'
import { useApiResource } from '@/hooks/use-api-resource'
import { useAuthStore } from '@/stores/use-auth-store'
import { apiErrorCopy } from '@/lib/api-error-copy'

interface CheckoutDetail {
  id: string
  createdAt: string
  items: Array<{
    orderId: string
    listingId: string
    sellerId: string
    status: string
    title: string
    price: { amount: string; currency: string }
  }>
}

export default function CheckoutDetailPage() {
  const { id } = useParams<{ id: string }>()
  const t = useTranslations('checkoutDetail')
  const locale = useLocale()
  const account = useAuthStore((state) => state.view?.account)
  const resource = useApiResource<CheckoutDetail>(`/checkouts/${encodeURIComponent(id)}`, {}, true)
  if (!account) return <p role="alert">{t('signIn')}</p>
  if (resource.loading) return <p role="status">{t('loading')}</p>
  if (resource.error || !resource.data)
    return (
      <p role="alert">
        {t('error', { error: resource.error ?? apiErrorCopy('NOT_FOUND', locale) })}
      </p>
    )
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="break-all text-sm text-muted-foreground">{resource.data.id}</p>
      <div className="rounded-xl border border-primary/25 bg-accent/40 p-4 text-sm">
        <p>{t('perItemOnly')}</p>
        <p className="mt-1 text-muted-foreground">{t('simulated')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {resource.data.items.map((item) => (
          <article key={item.orderId} className="min-w-0 rounded-xl border bg-card p-5">
            <Link
              href={`/me/orders/${item.orderId}`}
              className="break-words font-medium hover:underline"
            >
              {item.title}
            </Link>
            <p className="text-sm text-muted-foreground">
              {item.price.amount} {item.price.currency} · {transactionLabel(item.status, locale)}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}
