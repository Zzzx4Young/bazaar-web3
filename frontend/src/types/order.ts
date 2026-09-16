// Legacy UI order shape. Active Alpha order data uses src/lib/order-api.ts.
// Legacy UI order types retained for shared status presentation.

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
