// 模拟购买 modal（无后端，仅 UI 演示）
'use client'

import { useEffect, useRef, useState } from 'react'
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
import { useRouter } from '@/i18n/routing'
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
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const user = useUserStore(s => s.user)
  const { create } = useOrderStore()
  const [step, setStep] = useState<(typeof STEPS)[number]>('confirm')

  useEffect(() => {
    setStep('confirm')
    return () => { clearTimeout(timer.current); timer.current = undefined }
  }, [open, item?.id])

  if (!item) return null

  const reset = () => {
    setStep('confirm')
  }

  const handleConfirm = () => {
    if (step !== 'confirm' || timer.current) return
    setStep('fund')
    // 模拟 1.5 秒链上确认
    timer.current = setTimeout(() => {
      create({
        itemId: item.id,
        buyerId: user.id,
        sellerId: item.sellerId,
        amount: item.price,
        status: 'pending_fulfillment',
        role: 'buyer'
      })
      timer.current = undefined
      setStep('done')
    }, 1500)
  }

  const handleClose = () => {
    onOpenChange(false)
    clearTimeout(timer.current)
    timer.current = undefined
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle>确认购买</DialogTitle>
              <DialogDescription>
                确认后仅创建本地演示订单，不连接钱包，也不转移资金。
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
                <span className="text-muted-foreground">模拟手续费 (1%，不实际收取)</span>
                <span>
                  {formatPrice(
                    Number((item.price.amount * 0.01).toFixed(4)),
                    item.price.currency
                  )}
                </span>
              </div>
              <Badge variant="outline" className="text-xs">
                前端模拟 · 无真实资金
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
              <DialogTitle>模拟下单中...</DialogTitle>
              <DialogDescription>
                正在生成演示订单，无需操作钱包。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <div className="text-sm text-muted-foreground">
                等待模拟完成（约 1.5 秒）
              </div>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle>下单成功 ✓</DialogTitle>
              <DialogDescription>
                演示订单已保存到当前浏览器，可在「我的」页面查看。
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
                  ? '数字商品交付与资金释放尚未实现。'
                  : '实物发货、确认收货与资金释放尚未实现。'}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                关闭
              </Button>
              <Button onClick={() => { handleClose(); router.push('/me') }}>查看订单</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}