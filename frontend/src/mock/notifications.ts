// Mock notifications for the demo
import type { NotificationKind } from '@/types'

export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  href?: string
  read: boolean
  createdAt: string // ISO
}

export const mockNotifications: Notification[] = [
  {
    id: 'n_001',
    kind: 'order',
    title: '订单已确认',
    body: '你购买的 iPhone 15 Pro 卖家已发货',
    href: '/me',
    read: false,
    createdAt: '2026-08-01T08:30:00Z'
  },
  {
    id: 'n_002',
    kind: 'favorite',
    title: '商品降价',
    body: '你收藏的 MacBook Air M2 降价了 ¥2,799',
    href: '/listing/item_002',
    read: false,
    createdAt: '2026-08-01T07:15:00Z'
  },
  {
    id: 'n_003',
    kind: 'system',
    title: '欢迎来到 Bazaar Web3',
    body: '平台已上线测试中 · 所有交易 0 真实资金',
    read: true,
    createdAt: '2026-07-31T12:00:00Z'
  },
  {
    id: 'n_004',
    kind: 'order',
    title: '订单已完成',
    body: '你卖出的 ENS 域名买家已确认收货',
    href: '/me',
    read: true,
    createdAt: '2026-07-30T16:45:00Z'
  },
  {
    id: 'n_005',
    kind: 'system',
    title: '新功能上线',
    body: '支持中英双语切换，点击右下角切换',
    read: true,
    createdAt: '2026-07-29T10:00:00Z'
  }
]