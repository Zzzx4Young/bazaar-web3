'use client'

import { useState, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileHeader } from '@/components/me/profile-header'
import { OrderTable } from '@/components/me/order-table'
import { useOrderStore, selectByBuyer, selectBySeller } from '@/stores/use-order-store'
import { useUserStore } from '@/stores/use-user-store'
import { useAuthStore } from '@/stores/use-auth-store'
import { BackendOrders } from '@/components/me/backend-orders'
import { BackendListings } from '@/components/me/backend-listings'

export default function MePage() {
  const user = useUserStore((s) => s.user)
  const auth = useAuthStore()
  const orderState = useOrderStore()
  const [tab, setTab] = useState<'buyer' | 'seller'>('buyer')

  const buyerOrders = useMemo(() => selectByBuyer(user.id)(orderState), [orderState, user.id])
  // Match orders against the user's linkedSellerId (mock) so that a registered
  // merchant sees both their personal buys and their merchant-side sales.
  const sellerOrders = useMemo(
    () => selectBySeller(user.linkedSellerId ?? user.id)(orderState),
    [orderState, user.id, user.linkedSellerId]
  )

  return (
    <div className="space-y-6">
      <ProfileHeader />
      {auth.status === 'authenticated' && <BackendListings />}

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'buyer' | 'seller')}>
        <TabsList>
          <TabsTrigger value="buyer">我买到的</TabsTrigger>
          <TabsTrigger value="seller">我卖出的</TabsTrigger>
        </TabsList>
        <TabsContent value="buyer" className="mt-4">
          {auth.status === 'authenticated' ? (
            <BackendOrders role="buyer" />
          ) : (
            <OrderTable orders={buyerOrders} emptyVariant="buyer" />
          )}
        </TabsContent>
        <TabsContent value="seller" className="mt-4">
          {auth.status === 'authenticated' ? (
            <BackendOrders role="seller" />
          ) : (
            <OrderTable orders={sellerOrders} emptyVariant="seller" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
