'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApiResource } from '@/hooks/use-api-resource'
import { useOrderCommand } from '@/hooks/use-order-command'
import { orderActions, type OrderDetail } from '@/lib/order-api'
import { useAuthStore } from '@/stores/use-auth-store'

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const auth = useAuthStore()
  const resource = useApiResource<OrderDetail>(`/orders/${encodeURIComponent(params.id)}`, {}, true)
  const command = useOrderCommand()
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [carrier, setCarrier] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
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
      action === 'issue'
        ? { description }
        : action === 'deliver'
          ? order.type === 'digital'
            ? { url }
            : { carrier, trackingNumber }
          : action === 'accept'
            ? { confirmed: true }
            : action === 'restore'
              ? { inHandAndResellable: true }
              : {}
    const result = await command.run(`/orders/${order.id}/actions/${action}`, body)
    if (result) resource.reload()
  }
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{order.title}</h1>
        <p className="text-sm text-muted-foreground">
          {order.status} · {order.price.amount} {order.price.currency}
        </p>
      </div>
      {order.shipping && (
        <div className="rounded-lg border p-4 text-sm">
          <p className="font-medium">收货信息</p>
          <p>
            {order.shipping.recipient} · {order.shipping.contact}
          </p>
          <p>{order.shipping.address}</p>
        </div>
      )}
      {order.type === 'physical' && actions.includes('issue') && (
        <Input
          aria-label="问题描述"
          placeholder="描述商品问题"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      )}
      {order.type === 'digital' && actions.includes('deliver') && (
        <Input
          aria-label="交付链接"
          placeholder="https://…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
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
      {command.error && (
        <p role="alert" className="text-destructive">
          操作失败：{command.error}
        </p>
      )}
      {command.uncertain && (
        <p role="alert" className="text-destructive">
          结果未知，请重试同一操作。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button key={action} disabled={command.busy} onClick={() => void act(action)}>
            {action}
          </Button>
        ))}
      </div>
    </div>
  )
}
