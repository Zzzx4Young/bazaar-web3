'use client'

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { useApiResource } from '@/hooks/use-api-resource'
import { useAuthStore } from '@/stores/use-auth-store'

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
  const account = useAuthStore((state) => state.view?.account)
  const resource = useApiResource<CheckoutDetail>(`/checkouts/${encodeURIComponent(id)}`, {}, true)
  if (!account) return <p role="alert">{t('signIn')}</p>
  if (resource.loading) return <p role="status">{t('loading')}</p>
  if (resource.error || !resource.data)
    return <p role="alert">{t('error', { error: resource.error ?? 'NOT_FOUND' })}</p>
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="break-all text-sm text-muted-foreground">{resource.data.id}</p>
      {resource.data.items.map((item) => (
        <article key={item.orderId} className="rounded-lg border p-4">
          <Link href={`/me/orders/${item.orderId}`} className="break-words font-medium hover:underline">
            {item.title}
          </Link>
          <p className="text-sm text-muted-foreground">
            {item.price.amount} {item.price.currency} · {item.status}
          </p>
        </article>
      ))}
    </div>
  )
}
