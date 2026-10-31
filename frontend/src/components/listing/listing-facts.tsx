import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import type { Item } from '@/types'
import { CommitmentView } from './commitment-view'

const deliveryKeys = {
  download_link: 'deliveryDownloadLink',
  license_key: 'deliveryLicenseKey',
  cloud_link: 'deliveryCloudLink',
  account_credentials: 'deliveryAccountCredentials'
} as const

export function ListingFacts({ item }: { item: Item }) {
  const t = useTranslations('listingFacts')
  const conditionKey = item.condition
    ? `condition${item.condition === 'like_new' ? 'LikeNew' : item.condition[0]!.toUpperCase() + item.condition.slice(1)}`
    : undefined

  return (
    <Card>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div>
          <p className="market-eyebrow">{t('sellerStatement')}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            {item.category === 'digital' ? (
              <>
                <div className="min-w-0 border-t pt-3">
                  <dt className="text-muted-foreground">{t('license')}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words font-medium">
                    {item.licenseDescription?.trim() || t('notProvided')}
                  </dd>
                </div>
                <div className="min-w-0 border-t pt-3">
                  <dt className="text-muted-foreground">{t('version')}</dt>
                  <dd className="mt-1 break-words font-medium">
                    {item.contentVersion?.trim() || t('notProvided')}
                  </dd>
                </div>
                <div className="min-w-0 border-t pt-3 sm:col-span-2">
                  <dt className="text-muted-foreground">{t('delivery')}</dt>
                  <dd className="mt-1 font-medium">
                    {item.deliveryType ? t(deliveryKeys[item.deliveryType]) : t('notRecorded')}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div className="border-t pt-3">
                  <dt className="text-muted-foreground">{t('condition')}</dt>
                  <dd className="mt-1 font-medium">
                    {conditionKey ? t(conditionKey as 'conditionNew') : t('notRecorded')}
                  </dd>
                </div>
                <div className="border-t pt-3">
                  <dt className="text-muted-foreground">{t('delivery')}</dt>
                  <dd className="mt-1 font-medium">
                    {item.shippingMethod
                      ? t(
                          item.shippingMethod === 'delivery'
                            ? 'shippingDelivery'
                            : 'shippingFaceToFace'
                        )
                      : t('notRecorded')}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>
        <div className="border-t pt-4"><CommitmentView commitment={item.commitment} /></div>
        <div className="border-t pt-4 text-xs leading-5 text-muted-foreground">
          <strong className="font-semibold text-foreground">{t('platformRecord')}</strong>
          <p>{t('privateDelivery')}</p>
          <p>{t('futureChain')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
