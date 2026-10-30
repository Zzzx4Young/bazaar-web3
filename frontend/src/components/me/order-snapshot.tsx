import { useTranslations } from 'next-intl'
import type { OrderDetail } from '@/lib/order-api'

export function OrderSnapshot({ type, snapshot }: Pick<OrderDetail, 'type' | 'snapshot'>) {
  const t = useTranslations('orderDetailUi')
  return (
    <section className="rounded-xl border bg-card p-5 sm:p-6">
      <p className="market-eyebrow">{t('snapshot')}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t('sellerStatement')}</p>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div className="min-w-0 border-t pt-3 sm:col-span-2">
          <dt className="text-muted-foreground">{t('description')}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words">
            {snapshot.description.trim() || t('notProvided')}
          </dd>
        </div>
        {type === 'digital' && (
          <>
            <div className="min-w-0 border-t pt-3">
              <dt className="text-muted-foreground">{t('license')}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words">
                {snapshot.licenseDescription?.trim() || t('notProvided')}
              </dd>
            </div>
            <div className="min-w-0 border-t pt-3">
              <dt className="text-muted-foreground">{t('version')}</dt>
              <dd className="mt-1 break-words">
                {snapshot.contentVersion?.trim() || t('notProvided')}
              </dd>
            </div>
          </>
        )}
      </dl>
    </section>
  )
}
