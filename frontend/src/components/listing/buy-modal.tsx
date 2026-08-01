// 模拟购买 modal（无后端，仅 UI 演示）
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatPrice } from '@/lib/format'
import { useOrderStore } from '@/stores/use-order-store'
import { useUserStore } from '@/stores/use-user-store'
import type { Item } from '@/types'

interface BuyModalProps {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STEPS = ['confirm', 'fund', 'done'] as const

export function BuyModal({ item, open, onOpenChange }: BuyModalProps) {
  const user = useUserStore(s => s.user)
  const { create } = useOrderStore()
  const [step, setStep] = useState<(typeof STEPS)[number]>('confirm')

  if (!item) return null

  const reset = () => {
    setStep('confirm')
  }

  const handleConfirm = () => {
    setStep('fund')
    // 模拟 1.5 秒链上确认
    setTimeout(() => {
      create({
        itemId: item.id,
        buyerId: user.id,
        sellerId: item.sellerId,
        amount: item.price,
        status: item.category === 'digital' ? 'pending_fulfillment' : 'pending_confirm',
        role: 'buyer'
      })
      setStep('done')
    }, 1500)
  }

  const handleClose = () => {
    onOpenChange(false)
    setTimeout(reset, 300) // 等关闭动画
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle>确认购买</DialogTitle>
              <DialogDescription>
                资金将通过 Sepolia 测试网 escrow 合约托管。请确认商品信息无误。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="line-clamp-2 text-sm font-medium">{item.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.category === 'digital' ? '数字资产' : '实物二手'}
                </div>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">应付金额</span>
                <span className="text-2xl font-bold text-primary">
                  {formatPrice(item.price.amount, item.price.currency)}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">平台手续费 (1%)</span>
                <span>
                  {formatPrice(
                    Number((item.price.amount * 0.01).toFixed(4)),
                    item.price.currency
                  )}
                </span>
              </div>
              <Badge variant="outline" className="text-xs">
                🔒 Sepolia 测试网 · 0 真实资金
              </Badge>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                取消
              </Button>
              <Button onClick={handleConfirm}>确认下单</Button>
            </DialogFooter>
          </>
        )}

        {step === 'fund' && (
          <>
            <DialogHeader>
              <DialogTitle>链上确认中...</DialogTitle>
              <DialogDescription>
                请在钱包中确认交易。资金将自动锁入 escrow 合约。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <div className="text-sm text-muted-foreground">
                等待链上确认（约 15 秒）
              </div>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle>下单成功 ✓</DialogTitle>
              <DialogDescription>
                资金已锁入 escrow。卖家发货后你可确认收货完成交易。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <div className="rounded-lg border bg-green-50 p-4 text-sm dark:bg-green-950">
                <div className="font-medium text-green-900 dark:text-green-100">
                  订单已创建
                </div>
                <div className="mt-1 text-xs text-green-700 dark:text-green-300">
                  可在「我的 → 我买到的」查看订单状态
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {item.category === 'digital'
                  ? '数字商品将在卖家确认交付后自动释放'
                  : '实物商品将在你确认收货后自动释放给卖家'}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                关闭
              </Button>
              <Button onClick={handleClose}>查看订单</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}