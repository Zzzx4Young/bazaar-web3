'use client'

import { useEffect } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { ItemGrid } from '@/components/home/item-grid'
import { useBackendListings } from '@/hooks/use-backend-listings'
import { useApiResource } from '@/hooks/use-api-resource'
import { useStoredPage } from '@/hooks/use-stored-page'
import { RecordPagination } from '@/components/ui/record-pagination'
import { useLocale, useTranslations } from 'next-intl'
import { apiErrorCopy } from '@/lib/api-error-copy'

const SELLER_LISTINGS_PAGE_SIZE = 18

interface SellerProfile {
  id: string
  displayName: string
  reputation: { rating: string | null; ratingCount: number }
}

export default function SellerPage({ params }: { params: { id: string } }) {
  const t = useTranslations('sellerProfile')
  const locale = useLocale()
  const [page, setPage] = useStoredPage(`bazaar:seller:${params.id}`)
  const backend = useBackendListings(new URLSearchParams({
    sort: 'newest',
    limit: String(SELLER_LISTINGS_PAGE_SIZE),
    sellerId: params.id,
    page: String(page)
  }))
  const profile = useApiResource<SellerProfile>(`/sellers/${encodeURIComponent(params.id)}/profile`)
  useEffect(() => {
    if (backend.loading || backend.error) return
    const lastPage = Math.max(1, Math.ceil(backend.total / SELLER_LISTINGS_PAGE_SIZE))
    if (page > lastPage) setPage(lastPage)
  }, [backend.loading, backend.error, backend.total, page, setPage])
  if (backend.loading || profile.loading) return <p role="status">{t('loading')}</p>
  if (backend.error || profile.error)
    return (
      <p role="alert" className="text-destructive">
        {t('loadError', { error: backend.error ?? profile.error ?? apiErrorCopy('NOT_FOUND', locale) })}
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
      {backend.total > SELLER_LISTINGS_PAGE_SIZE && (
        <RecordPagination
          page={page}
          limit={SELLER_LISTINGS_PAGE_SIZE}
          total={backend.total}
          hasMore={backend.hasMore}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
