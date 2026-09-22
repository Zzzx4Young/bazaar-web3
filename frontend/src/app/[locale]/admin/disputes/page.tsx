'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useApiResource } from '@/hooks/use-api-resource'
import { useAuthStore } from '@/stores/use-auth-store'

interface DisputeSummary {
  id: string
  title: string
  status: string
  currency: string
  amount: string
  hasCounteroffer: boolean
}

export default function AdminDisputesPage() {
  const { locale } = useParams<{ locale: string }>()
  const t = useTranslations('adminDisputes')
  const role = useAuthStore((state) => state.view?.account.role)
  const disputes = useApiResource<{ items: DisputeSummary[] }>('/admin/disputes', {}, true)
  if (role !== 'admin') return <p role="alert">{t('restricted')}</p>
  if (disputes.loading) return <p role="status">{t('loading')}</p>
  if (disputes.error) return <p role="alert">{t('loadError', { error: disputes.error })}</p>
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {!disputes.data?.items.length && <p>{t('empty')}</p>}
      {disputes.data?.items.map((item) => (
        <Link
          key={item.id}
          href={`/${locale}/admin/disputes/${item.id}`}
          className="block rounded-lg border p-4 hover:bg-muted"
        >
          <p className="break-words font-medium">{item.title}</p>
          <p className="text-sm text-muted-foreground">
            {item.amount} {item.currency} · {item.hasCounteroffer ? t('offerReady') : t('offerPending')}
          </p>
        </Link>
      ))}
    </div>
  )
}
