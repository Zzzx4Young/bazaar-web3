'use client'

import { useState, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileHeader } from '@/components/me/profile-header'
import { OrderTable } from '@/components/me/order-table'
import { useOrderStore, selectByBuyer, selectBySeller } from '@/stores/use-order-store'
import { useUserStore } from '@/stores/use-user-store'

export default function MePage() {
  const user = useUserStore(s => s.user)
  const orderState = useOrderStore()
  const [tab, setTab] = useState<'buyer' | 'seller'>('buyer')

  const buyerOrders = useMemo(() => selectByBuyer(user.id)(orderState), [orderState, user.id])
  const sellerOrders = useMemo(() => selectBySeller(user.id)(orderState), [orderState, user.id])

  return (
    <div className="space-y-6">
      <ProfileHeader />

      <Tabs value={tab} onValueChange={v => setTab(v as 'buyer' | 'seller')}>
        <TabsList>
          <TabsTrigger value="buyer">我买到的 ({buyerOrders.length})</TabsTrigger>
          <TabsTrigger value="seller">我卖出的 ({sellerOrders.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="buyer" className="mt-4">
          <OrderTable orders={buyerOrders} emptyText="还没有买过东西，去逛逛吧" />
        </TabsContent>
        <TabsContent value="seller" className="mt-4">
          <OrderTable orders={sellerOrders} emptyText="还没有卖出东西，发布商品试试" />
        </TabsContent>
      </Tabs>
    </div>
  )
}