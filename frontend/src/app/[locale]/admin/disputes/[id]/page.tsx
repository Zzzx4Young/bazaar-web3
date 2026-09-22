'use client'

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApiResource } from '@/hooks/use-api-resource'
import { useOrderCommand } from '@/hooks/use-order-command'
import { useAuthStore } from '@/stores/use-auth-store'
import { useState } from 'react'

interface DisputeDetail {
  id: string
  title: string
  status: string
  type: 'physical' | 'digital'
  price: { amount: string; currency: string }
  issue: string | null
  refundRequested: boolean
  counteroffer: string | null
}

export default function AdminDisputeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const t = useTranslations('adminDisputes')
  const role = useAuthStore((state) => state.view?.account.role)
  const dispute = useApiResource<DisputeDetail>(`/admin/disputes/${encodeURIComponent(id)}`, {}, true)
  const command = useOrderCommand()
  const [returnOutcome, setReturnOutcome] = useState<'not_sent' | 'returned' | 'not_required'>('returned')
  if (role !== 'admin') return <p role="alert">{t('restricted')}</p>
  if (dispute.loading) return <p role="status">{t('loading')}</p>
  if (dispute.error || !dispute.data) return <p role="alert">{t('loadError', { error: dispute.error ?? 'NOT_FOUND' })}</p>
  const item = dispute.data
  const resolve = async (outcome: 'refund' | 'release') => {
    const result = await command.run(`/admin/disputes/${item.id}/resolve`, {
      outcome,
      ...(outcome === 'refund' && item.type === 'physical' ? { returnOutcome } : {})
    })
    if (result) dispute.reload()
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="break-words text-2xl font-bold">{item.title}</h1>
      <p data-testid="admin-dispute-status">{item.status} · {item.price.amount} {item.price.currency}</p>
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">{t('buyerIssue')}</h2>
        <p className="break-words">{item.issue ?? t('noIssue')}</p>
      </section>
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">{t('sellerOffer')}</h2>
        <p className="break-words">{item.counteroffer ?? t('offerPending')}</p>
      </section>
      {item.status === 'issue' && item.refundRequested && item.counteroffer && (
        <div className="space-y-3">
          {item.type === 'physical' && (
            <Select value={returnOutcome} onValueChange={(value) => setReturnOutcome(value as typeof returnOutcome)}>
              <SelectTrigger aria-label={t('refundOutcome')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="returned">{t('returned')}</SelectItem>
                <SelectItem value="not_sent">{t('notSent')}</SelectItem>
                <SelectItem value="not_required">{t('notRequired')}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-2">
            <Button disabled={command.busy || command.uncertain} onClick={() => void resolve('refund')}>
              {t('refund')}
            </Button>
            <Button variant="outline" disabled={command.busy || command.uncertain} onClick={() => void resolve('release')}>
              {t('release')}
            </Button>
          </div>
        </div>
      )}
      {command.error && <p role="alert">{t('actionError', { error: command.error })}</p>}
      {command.uncertain && (
        <Button variant="outline" disabled={command.busy} onClick={async () => {
          if (await command.retry()) dispute.reload()
        }}>
          {t('retry')}
        </Button>
      )}
    </div>
  )
}
