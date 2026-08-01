// Order / 订单（mock，不上链）
// 对应 docs/mock-data-spec.md §4.3

import type { Currency } from './item'

export type OrderStatus =
  | 'pending_payment' // 待付款
  | 'pending_fulfillment' // 待发货/待交付
  | 'pending_confirm' // 待确认收货
  | 'completed' // 已完成
  | 'cancelled' // 已取消

export interface OrderAmount {
  amount: number
  currency: Currency
}

export interface Order {
  id: string
  itemId: string
  buyerId: string
  sellerId: string
  amount: OrderAmount
  status: OrderStatus
  createdAt: string
  // 个人中心过滤用
  role?: 'buyer' | 'seller'
}