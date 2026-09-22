'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { ItemGrid } from '@/components/home/item-grid'
import { useBackendListings } from '@/hooks/use-backend-listings'
import { useApiResource } from '@/hooks/use-api-resource'
import { useTranslations } from 'next-intl'

interface SellerProfile {
  id: string
  displayName: string
  reputation: { rating: string | null; ratingCount: number }
}

export default function SellerPage({ params }: { params: { id: string } }) {
  const t = useTranslations('sellerProfile')
  const backend = useBackendListings(new URLSearchParams({ sort: 'newest', limit: '50', sellerId: params.id }))
  const profile = useApiResource<SellerProfile>(`/sellers/${encodeURIComponent(params.id)}/profile`)
  if (backend.loading || profile.loading) return <p role="status">{t('loading')}</p>
  if (backend.error || profile.error)
    return (
      <p role="alert" className="text-destructive">
        {t('loadError', { error: backend.error ?? profile.error ?? 'NOT_FOUND' })}
      </p>
    )
  const sellerItems = backend.items
  const sellerProfile = profile.data

  if (!sellerProfile)
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          {t('unavailable')}
        </CardContent>
      </Card>
    )

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <Avatar className="h-16 w-16">
            <AvatarFallback>{sellerProfile.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{sellerProfile.displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('listingCount', { count: backend.total })}
            </p>
            <p data-testid="seller-reputation" className="text-sm text-muted-foreground">
              {sellerProfile.reputation.rating === null
                ? t('noReviews')
                : t('reputation', {
                    rating: sellerProfile.reputation.rating,
                    count: sellerProfile.reputation.ratingCount
                  })}
            </p>
          </div>
        </CardContent>
      </Card>
      <ItemGrid items={sellerItems} title={t('listings')} />
    </div>
  )
}
