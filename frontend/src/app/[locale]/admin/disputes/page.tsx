'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { transactionLabel } from '@/lib/transaction-copy'
import { useApiResource } from '@/hooks/use-api-resource'
import { useAuthStore } from '@/stores/use-auth-store'
import { useStoredPage } from '@/hooks/use-stored-page'
import { RecordPagination } from '@/components/ui/record-pagination'
import { paginationPolicy } from '@/lib/pagination'

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
  const accountId = useAuthStore((state) => state.view?.account.id)
  const [page, setPage] = useStoredPage(`bazaar:disputes:${accountId ?? 'guest'}`)
  const disputes = useApiResource<{
    items: DisputeSummary[]
    page: number
    limit: number
    total: number
    hasMore: boolean
  }>(`/admin/disputes?page=${page}&limit=${paginationPolicy.defaultLimit}`, {}, true)
  if (role !== 'admin') return <p role="alert">{t('restricted')}</p>
  if (disputes.loading) return <p role="status">{t('loading')}</p>
  if (disputes.error) return <p role="alert">{t('loadError', { error: disputes.error })}</p>
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {!disputes.data?.items.length && <p>{t('empty')}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {disputes.data?.items.map((item) => (
          <Link
            key={item.id}
            href={`/${locale}/admin/disputes/${item.id}`}
            className="block min-w-0 rounded-xl border bg-card p-5 hover:border-primary/50 hover:bg-muted"
          >
            <p className="break-words font-medium">{item.title}</p>
            <p className="text-sm text-muted-foreground">
              {item.amount} {item.currency} · {transactionLabel(item.status, locale)} ·{' '}
              {item.hasCounteroffer ? t('offerReady') : t('offerPending')}
            </p>
          </Link>
        ))}
      </div>
      {disputes.data && (
        <RecordPagination
          page={page}
          limit={disputes.data.limit}
          total={disputes.data.total}
          hasMore={disputes.data.hasMore}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
