'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { OrderHistory, useOrderHistory } from '@/components/me/order-history'
import { useApiResource } from '@/hooks/use-api-resource'
import { useOrderCommand } from '@/hooks/use-order-command'
import { acceptanceOrderStatus, orderActions, type OrderDetail, type SimulatedBalance } from '@/lib/order-api'
import { useAuthStore } from '@/stores/use-auth-store'

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const tDispute = useTranslations('orderDispute')
  const tReview = useTranslations('orderReview')
  const auth = useAuthStore()
  const resource = useApiResource<OrderDetail>(`/orders/${encodeURIComponent(params.id)}`, {}, true)
  const command = useOrderCommand()
  const history = useOrderHistory(params.id)
  const balances = useApiResource<{ items: SimulatedBalance[] }>('/balances', {}, true)
  const reloadOrder = resource.reload
  const reloadBalances = balances.reload
  const [description, setDescription] = useState('')
  const [rating, setRating] = useState('5')
  const [url, setUrl] = useState('')
  const [carrier, setCarrier] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [returnOutcome, setReturnOutcome] = useState<'not_sent' | 'returned' | 'not_required'>(
    'returned'
  )
  useEffect(() => {
    const timer = window.setInterval(() => {
      reloadOrder()
      reloadBalances()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [reloadOrder, reloadBalances])
  if (resource.loading) return <p role="status">正在加载订单…</p>
  if (resource.error || !resource.data)
    return (
      <p role="alert" className="text-destructive">
        订单加载失败：{resource.error ?? 'NOT_FOUND'}
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
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{order.title}</h1>
        <p className="text-sm text-muted-foreground">
          <span data-testid="acceptance-order-status">{acceptanceOrderStatus(order.status)}</span>
          {' · '}
          <span>{order.status}</span> · {order.price.amount} {order.price.currency}
        </p>
      </div>
      {order.checkoutId && (
        <Link href={`/me/checkouts/${order.checkoutId}`} className="text-sm text-primary hover:underline">
          {tReview('viewCheckout')}
        </Link>
      )}
      {order.shipping && (
        <div className="rounded-lg border p-4 text-sm">
          <p className="font-medium">收货信息</p>
          <p>
            {order.shipping.recipient} · {order.shipping.contact}
          </p>
          <p>{order.shipping.address}</p>
        </div>
      )}
      {actions.includes('issue') && (
        <Input
          aria-label="问题描述"
          placeholder="描述商品问题"
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
            aria-label="交付链接"
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Input
            aria-label="提取码"
            placeholder="提取码（可选）"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
          />
        </div>
      )}
      {order.type === 'physical' && actions.includes('deliver') && (
        <div className="flex gap-2">
          <Input
            aria-label="物流公司"
            placeholder="物流公司"
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
          />
          <Input
            aria-label="物流单号"
            placeholder="物流单号"
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
          <SelectTrigger aria-label="退货结果">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="returned">已退回卖家</SelectItem>
            <SelectItem value="not_sent">尚未发货</SelectItem>
            <SelectItem value="not_required">无需退回</SelectItem>
          </SelectContent>
        </Select>
      )}
      {command.error && (
        <p role="alert" className="text-destructive">
          操作失败：{command.error}
        </p>
      )}
      {command.uncertain && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>结果未知，请重试原操作。</p>
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
            重试原操作
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            disabled={command.busy || command.uncertain}
            onClick={() => void act(action)}
          >
            {action}
          </Button>
        ))}
      </div>
      {order.status === 'completed' && auth.view?.account.id === order.buyerId && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">{tReview('title')}</p>
          {order.review ? (
            <p data-testid="order-review">{tReview('submitted', { rating: order.review.rating })}</p>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger aria-label={tReview('rating')} className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={command.busy || command.uncertain} onClick={async () => {
                if (await command.run(`/orders/${order.id}/review`, { rating: Number(rating) }))
                  resource.reload()
              }}>{tReview('submit')}</Button>
            </div>
          )}
        </div>
      )}
      {!!balances.data?.items.length && (
        <div data-testid="simulated-balance" className="rounded-lg border p-3 text-sm">
          <p className="font-medium">{tDispute('balance')}</p>
          {balances.data.items.map((item) => (
            <p key={item.currency}>{item.amount} {item.currency}</p>
          ))}
        </div>
      )}
      <OrderHistory history={history} />
    </div>
  )
}
