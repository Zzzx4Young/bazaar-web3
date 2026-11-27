'use client'
import { useTranslations } from 'next-intl'
export function EscrowStatus({
  state,
  deadline,
  waiting
}: {
  state: string
  deadline?: number | null
  waiting?: boolean
}) {
  const t = useTranslations('web3')
  return (
    <section className="space-y-2 rounded-xl border p-4">
      <p>{t('state', { value: t.has('states.' + state) ? t('states.' + state) : state })}</p>
      {waiting && <p role="status">{t('waiting')}</p>}
      {deadline != null && <p>{t('deadline', { value: String(deadline) })}</p>}
      {state === 'Refunded' && <p>{t('refundLinks')}</p>}
      <p className="text-sm text-muted-foreground">{t('downloadWarning')}</p>
    </section>
  )
}
