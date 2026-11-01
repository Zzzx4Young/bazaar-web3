'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileHeader } from '@/components/me/profile-header'
import { useAuthStore } from '@/stores/use-auth-store'
import { BackendOrders } from '@/components/me/backend-orders'
import { BackendListings } from '@/components/me/backend-listings'
import { ListingReviewQueue } from '@/components/me/listing-review-queue'
import { Card, CardContent } from '@/components/ui/card'
import { IdentitySettings } from '@/components/me/identity-settings'
import { useTranslations } from 'next-intl'

export default function MePage() {
  const t = useTranslations('mePage')
  const status = useAuthStore((state) => state.status)
  const [tab, setTab] = useState<'buyer' | 'seller'>('buyer')

  if (status === 'loading') return <p role="status">{t('loading')}</p>
  if (status !== 'authenticated')
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <h1 className="text-xl font-semibold">{t('signInTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('signInHint')}
          </p>
        </CardContent>
      </Card>
    )

  return (
    <div className="space-y-6">
      <ProfileHeader />
      <IdentitySettings />
      <ListingReviewQueue />
      <BackendListings />
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'buyer' | 'seller')}>
        <TabsList>
          <TabsTrigger value="buyer">{t('buyerTab')}</TabsTrigger>
          <TabsTrigger value="seller">{t('sellerTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="buyer" className="mt-4">
          <BackendOrders role="buyer" />
        </TabsContent>
        <TabsContent value="seller" className="mt-4">
          <BackendOrders role="seller" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
