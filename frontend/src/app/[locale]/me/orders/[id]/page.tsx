'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MediaCarousel } from '@/components/listing/media-carousel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { OrderHistory, useOrderHistory } from '@/components/me/order-history'
import { OrderSnapshot } from '@/components/me/order-snapshot'
import { useApiResource } from '@/hooks/use-api-resource'
import { useOrderCommand } from '@/hooks/use-order-command'
import { useVisiblePolling } from '@/hooks/use-visible-polling'
import { orderRefreshIntervalMs } from '@/lib/refresh-policy'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { hasIllustrativeImages } from '@/lib/listing-illustration'
import { orderActions, type OrderDetail, type SimulatedBalance } from '@/lib/order-api'
import {
  transactionActionLabel,
  transactionConsequence,
  transactionLabel
} from '@/lib/transaction-copy'
import { useAuthStore } from '@/stores/use-auth-store'

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const tDispute = useTranslations('orderDispute')
  const tReview = useTranslations('orderReview')
  const tUi = useTranslations('orderDetailUi')
  const locale = useLocale()
  const auth = useAuthStore()
  const resource = useApiResource<OrderDetail>(`/orders/${encodeURIComponent(params.id)}`, {}, true)
  const command = useOrderCommand()
  const history = useOrderHistory(params.id)
  const balances = useApiResource<{ items: SimulatedBalance[] }>('/balances', {}, true)
  const reloadBalances = balances.reload
  const reloadHistory = history.reload
  const previousStatus = useRef<string>()
  const [description, setDescription] = useState('')
  const [rating, setRating] = useState('5')
  const [url, setUrl] = useState('')
  const [carrier, setCarrier] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [returnOutcome, setReturnOutcome] = useState<'not_sent' | 'returned' | 'not_required'>(
    'returned'
  )
  useVisiblePolling(resource.poll, !!auth.view, orderRefreshIntervalMs)
  useEffect(() => {
    const status = resource.data?.status
    if (!status) return
    if (previousStatus.current && previousStatus.current !== status) {
      reloadHistory()
      reloadBalances()
    }
    previousStatus.current = status
  }, [resource.data?.status, reloadBalances, reloadHistory])
  if (resource.loading) return <p role="status">{tUi('loading')}</p>
  if (resource.error || !resource.data)
    return (
      <p role="alert" className="text-destructive">
        {tUi('loadError', { error: resource.error ?? apiErrorCopy('NOT_FOUND', locale) })}
      </p>
    )
  const order = resource.data
  const actions = orderActions(order, auth.view?.account.id ?? '')
  const act = async (action: string) => {
    const body =
      action === 'issue' || action === 'counteroffer'
        ? { description }
        : action === 'deliver'
          ? order.type === 'digital'
            ? { url, ...(accessCode ? { accessCode } : {}) }
            : { carrier, trackingNumber }
          : action === 'accept'
            ? { confirmed: true }
            : action === 'restore'
              ? { inHandAndResellable: true }
              : action === 'refund' && order.type === 'physical'
                ? { returnOutcome }
                : {}
    const result = await command.run(`/orders/${order.id}/actions/${action}`, body)
    if (result) {
      resource.reload()
      history.reload()
      balances.reload()
    }
  }
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{order.title}</h1>
        <p className="text-sm text-muted-foreground">
          <span data-testid="acceptance-order-status">
            {transactionLabel(order.status, locale)}
          </span>
          {' · '}
          {order.price.amount} {order.price.currency}
        </p>
      </div>
      <div className="max-w-xl">
        <MediaCarousel
          media={(order.snapshot.media ?? []).map((entry) => ({
            type: 'image',
            url: entry.url,
            alt: order.snapshot.title
          }))}
          alt={order.snapshot.title}
          illustrative={hasIllustrativeImages(order.snapshot.description)}
        />
      </div>
      <OrderSnapshot type={order.type} snapshot={order.snapshot} />
      <div className="rounded-xl border bg-secondary/60 p-4 text-sm">
        <strong>{tUi('simulated')}</strong>
        <p className="mt-1 text-muted-foreground">{tUi('futureWallet')}</p>
      </div>
      {order.checkoutId && (
        <Link
          href={`/me/checkouts/${order.checkoutId}`}
          className="text-sm text-primary hover:underline"
        >
          {tReview('viewCheckout')}
        </Link>
      )}
      {order.shipping && (
        <div className="rounded-lg border p-4 text-sm">
          <p className="font-medium">{tUi('shipping')}</p>
          <p>
            {order.shipping.recipient} · {order.shipping.contact}
          </p>
          <p>{order.shipping.address}</p>
        </div>
      )}
      {actions.includes('issue') && (
        <Input
          aria-label={tUi('issueLabel')}
          placeholder={tUi('issueHint')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      )}
      {actions.includes('counteroffer') && (
        <Input
          aria-label={tDispute('sellerOffer')}
          placeholder={tDispute('sellerOfferHint')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      )}
      {order.type === 'digital' && actions.includes('deliver') && (
        <div className="space-y-2">
          <Input
            aria-label={tUi('deliveryLink')}
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Input
            aria-label={tUi('accessCode')}
            placeholder={tUi('optionalAccessCode')}
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
          />
        </div>
      )}
      {order.type === 'physical' && actions.includes('deliver') && (
        <div className="flex gap-2">
          <Input
            aria-label={tUi('carrier')}
            placeholder={tUi('carrier')}
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
          />
          <Input
            aria-label={tUi('trackingNumber')}
            placeholder={tUi('trackingNumber')}
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
          />
        </div>
      )}
      {order.type === 'physical' && actions.includes('refund') && (
        <Select
          value={returnOutcome}
          onValueChange={(value) => setReturnOutcome(value as typeof returnOutcome)}
        >
          <SelectTrigger aria-label={tUi('returnOutcome')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="returned">{tUi('returned')}</SelectItem>
            <SelectItem value="not_sent">{tUi('notSent')}</SelectItem>
            <SelectItem value="not_required">{tUi('notRequired')}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {command.error && (
        <p role="alert" className="text-destructive">
          {tUi('actionError', { error: command.error })}
        </p>
      )}
      {command.uncertain && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{tUi('uncertain')}</p>
          <Button
            variant="outline"
            disabled={command.busy}
            onClick={async () => {
              const result = await command.retry()
              if (result) {
                resource.reload()
                history.reload()
              }
            }}
          >
            {tUi('retry')}
          </Button>
        </div>
      )}
      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{tUi('nextAction')}</h2>
        {actions.length === 0 && <p className="text-sm text-muted-foreground">{tUi('noAction')}</p>}
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
            <div key={action} className="max-w-xs space-y-1">
              <Button disabled={command.busy || command.uncertain} onClick={() => void act(action)}>
                {transactionActionLabel(action, locale)}
              </Button>
              {transactionConsequence(action, locale) && (
                <p className="text-xs text-muted-foreground">
                  {transactionConsequence(action, locale)}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
      {order.status === 'completed' && auth.view?.account.id === order.buyerId && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">{tReview('title')}</p>
          {order.review ? (
            <p data-testid="order-review">
              {tReview('submitted', { rating: order.review.rating })}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger aria-label={tReview('rating')} className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={command.busy || command.uncertain}
                onClick={async () => {
                  if (await command.run(`/orders/${order.id}/review`, { rating: Number(rating) }))
                    resource.reload()
                }}
              >
                {tReview('submit')}
              </Button>
            </div>
          )}
        </div>
      )}
      {!!balances.data?.items.length && (
        <div data-testid="simulated-balance" className="rounded-lg border p-3 text-sm">
          <p className="font-medium">{tDispute('balance')}</p>
          {balances.data.items.map((item) => (
            <p key={item.currency}>
              {item.amount} {item.currency}
            </p>
          ))}
        </div>
      )}
      <OrderHistory history={history} />
    </div>
  )
}
