'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { useAuthStore } from '@/stores/use-auth-store'
import { useOrderCommand } from '@/hooks/use-order-command'
import type { Item } from '@/types'

export function BuyModal({
  item,
  open,
  onOpenChange
}: {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const auth = useAuthStore()
  const command = useOrderCommand()
  const [shipping, setShipping] = useState({ recipient: '', contact: '', address: '' })
  useEffect(() => {
    if (open) setShipping({ recipient: '', contact: '', address: '' })
  }, [open, item?.id])
  if (!item) return null
  const submit = async () => {
    if (auth.status !== 'authenticated' || !item.backendVersion) return
    const result = await command.run('/orders', {
      listingId: item.id,
      version: item.backendVersion,
      ...(item.category === 'physical' ? { shipping } : {})
    })
    if (result) {
      onOpenChange(false)
      router.push('/me')
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认下单</DialogTitle>
          <DialogDescription>订单将写入 Alpha 后端；付款仍为模拟动作。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="font-medium">{item.title}</p>
          <p className="text-sm text-muted-foreground">
            {item.price.exactAmount ?? item.price.amount} {item.price.currency}
          </p>
          {item.category === 'physical' && (
            <div className="space-y-2">
              <Label htmlFor="recipient">收件人</Label>
              <Input
                id="recipient"
                value={shipping.recipient}
                onChange={(e) => setShipping({ ...shipping, recipient: e.target.value })}
              />
              <Label htmlFor="contact">联系方式</Label>
              <Input
                id="contact"
                value={shipping.contact}
                onChange={(e) => setShipping({ ...shipping, contact: e.target.value })}
              />
              <Label htmlFor="address">收货地址</Label>
              <Input
                id="address"
                value={shipping.address}
                onChange={(e) => setShipping({ ...shipping, address: e.target.value })}
              />
            </div>
          )}
          {auth.status !== 'authenticated' && (
            <p role="alert" className="text-sm text-destructive">
              请先登录。
            </p>
          )}
          {command.error && (
            <p role="alert" className="text-sm text-destructive">
              下单失败：{command.error}
            </p>
          )}
          {command.uncertain && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>请求结果未知，请重试原操作，系统会复用原请求和幂等键。</p>
              <Button
                variant="outline"
                disabled={command.busy}
                onClick={async () => {
                  const result = await command.retry()
                  if (result) {
                    onOpenChange(false)
                    router.push('/me')
                  }
                }}
              >
                重试原操作
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={command.busy || command.uncertain || auth.status !== 'authenticated'}
            onClick={() => void submit()}
          >
            {command.busy ? '提交中…' : '确认下单'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
