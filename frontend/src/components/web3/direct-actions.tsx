'use client'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  buildDirectPackage,
  type DeliveryView,
  type OrderAddresses
} from '@/lib/web3/escrow-client'
export function DirectActions({
  order,
  snapshot
}: {
  order: OrderAddresses
  snapshot?: Pick<
    DeliveryView,
    | 'state'
    | 'deliveryDeadline'
    | 'acceptanceDeadline'
    | 'disputeDeadline'
    | 'finalizedHeight'
    | 'finalizedBlockHash'
  >
}) {
  const t = useTranslations('web3')
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(buildDirectPackage(order, snapshot), null, 2)], {
        type: 'application/json'
      })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'bazaar-' + order.chainOrderId + '.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section className="space-y-2 rounded-xl border p-4">
      <Button variant="outline" onClick={save}>
        {t('offline')}
      </Button>
      <p className="text-sm text-muted-foreground">{t('offlineHint')}</p>
      <dl className="break-all text-xs">
        <dt>{t('fixedBuyer')}</dt>
        <dd>{order.buyer}</dd>
        <dt>{t('fixedSeller')}</dt>
        <dd>{order.seller}</dd>
        <dt>{t('coordinates')}</dt>
        <dd>
          {order.chainId} / {order.escrow} / {order.chainOrderId}
        </dd>
      </dl>
    </section>
  )
}
