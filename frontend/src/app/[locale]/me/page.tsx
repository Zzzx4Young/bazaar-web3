'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileHeader } from '@/components/me/profile-header'
import { useAuthStore } from '@/stores/use-auth-store'
import { BackendOrders } from '@/components/me/backend-orders'
import { BackendListings } from '@/components/me/backend-listings'
import { Card, CardContent } from '@/components/ui/card'

export default function MePage() {
  const status = useAuthStore((state) => state.status)
  const [tab, setTab] = useState<'buyer' | 'seller'>('buyer')

  if (status === 'loading') return <p role="status">正在恢复账户会话…</p>
  if (status !== 'authenticated')
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <h1 className="text-xl font-semibold">登录后查看个人中心</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            请使用页面右上角的登录入口。个人商品和订单均从 Alpha 服务端读取。
          </p>
        </CardContent>
      </Card>
    )

  return (
    <div className="space-y-6">
      <ProfileHeader />
      <BackendListings />
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'buyer' | 'seller')}>
        <TabsList>
          <TabsTrigger value="buyer">我买到的</TabsTrigger>
          <TabsTrigger value="seller">我卖出的</TabsTrigger>
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
