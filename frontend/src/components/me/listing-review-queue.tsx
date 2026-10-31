'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useApiResource } from '@/hooks/use-api-resource'
import { useAuthStore } from '@/stores/use-auth-store'

type ReviewEntry = {
  id: string
  title: string
  type: 'physical' | 'digital'
  reviewStatus: 'clear' | 'paused' | 'rejected'
  reviewPending: boolean
  reviewKind: string | null
  reviewReason: string | null
  events: { action: string; reason: string; evidence: string | null; createdAt: string }[]
  orders: { id: string; status: string }[]
}

export function ListingReviewQueue() {
  const t = useTranslations('commitmentUi')
  const isAdmin = useAuthStore((state) => state.view?.account.role === 'admin')
  const resource = useApiResource<ReviewEntry[]>('/listings/review-queue', {}, isAdmin)
  const [reason, setReason] = useState('')
  const [returnOutcome, setReturnOutcome] = useState('not_sent')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!isAdmin) return null
  const run = async (path: string, body: unknown) => {
    setError('')
    setBusy(true)
    try { await authenticatedPost(path, body); resource.reload() }
    catch { setError(t('reviewError')) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">{t('reviewQueue')}</h2>
    {resource.error && <p role="alert">{resource.error}</p>}
    {error && <p role="alert">{error}</p>}
    {resource.data?.map((entry) => <article key={entry.id} className="space-y-2 border-t pt-3">
      <h3 className="font-medium">{entry.title} · {entry.reviewStatus === 'paused' ? t('underReview')
        : entry.reviewStatus === 'rejected' ? t('rule_violation') : t('reportPending')}</h3>
      <p className="text-sm">{entry.reviewReason}</p>
      <ol className="space-y-1 text-xs text-muted-foreground">
        {entry.events.map((event, index) => <li key={index}>
          {event.createdAt} · {event.action} · {event.reason}
          {event.evidence && <pre className="whitespace-pre-wrap break-all">{event.evidence}</pre>}
        </li>)}
      </ol>
      <Textarea aria-label={t('reviewReason')} value={reason}
        onChange={(event) => setReason(event.target.value)} />
      {entry.reviewStatus === 'clear' && entry.reviewPending && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || !reason.trim()}
          onClick={() => void run(`/listings/${entry.id}/pause-review`,
            { kind: entry.reviewKind ?? 'listing_rule', reason })}>{t('pauseReview')}</Button>
        <Button type="button" variant="outline" disabled={busy || !reason.trim()}
          onClick={() => void run(`/listings/${entry.id}/dismiss-report`,
            { reason })}>{t('dismissReport')}</Button>
      </div>}
      {entry.reviewStatus === 'paused' && <div className="flex flex-wrap gap-2">
        {(['resume', 'continue_pause', 'rule_violation'] as const).map((outcome) =>
          <Button key={outcome} type="button" variant="outline"
            disabled={busy || !reason.trim()}
            onClick={() => void run(`/listings/${entry.id}/review`, { outcome, reason })}>
            {t(outcome)}
          </Button>)}
      </div>}
      {entry.reviewStatus === 'rejected' && entry.orders.map((order) =>
        <div key={order.id} className="space-y-2 rounded border p-2 text-sm">
          <p>{order.id} · {order.status}</p>
          {entry.type === 'physical' && order.status !== 'pending_payment' && <select className="rounded border bg-background p-2"
            aria-label={t('returnOutcome')} value={returnOutcome}
            onChange={(event) => setReturnOutcome(event.target.value)}>
            <option value="not_sent">{t('notSent')}</option>
            <option value="returned">{t('returned')}</option>
            <option value="not_required">{t('notRequired')}</option>
          </select>}
          <Button type="button" variant="outline" disabled={busy || !reason.trim()}
            onClick={() => void run(`/listings/${entry.id}/review-orders/${order.id}/resolve`,
              { reason, ...(order.status === 'pending_payment' || entry.type !== 'physical'
                ? {} : { returnOutcome }) })}>
            {order.status === 'pending_payment' ? t('manualCancel') : t('manualRefund')}
          </Button>
        </div>)}
    </article>)}
  </section>
}
