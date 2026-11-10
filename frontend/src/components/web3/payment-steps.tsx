'use client'
import { useTranslations } from 'next-intl'
export type PaymentStage =
  | 'idle'
  | 'approvalSubmitted'
  | 'approvalIncluded'
  | 'submitted'
  | 'included'
  | 'finalized'
  | 'reverted'
  | 'replaced'
  | 'pending'
export function PaymentSteps({ status, hash }: { status: PaymentStage; hash?: string }) {
  const t = useTranslations('web3')
  return (
    <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
      <p role="status">{t(status)}</p>
      {hash && <p className="break-all font-mono text-xs">{hash}</p>}
      <p className="text-sm text-muted-foreground">{t('gas')}</p>
    </div>
  )
}
