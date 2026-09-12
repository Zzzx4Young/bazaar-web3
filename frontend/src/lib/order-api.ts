export interface Page<T> {
  items: T[]
  page: number
  limit: number
  hasMore: boolean
}
export interface Money {
  amount: string
  currency: string
}
export interface Shipping {
  recipient: string
  contact: string
  address: string
}
export type OrderStatus =
  | 'pending_payment'
  | 'pending_delivery'
  | 'pending_acceptance'
  | 'issue'
  | 'completed'
  | 'cancelled'
  | 'refunded'
export interface OrderSummary {
  id: string
  listingId: string
  buyerId: string
  sellerId: string
  status: OrderStatus
  title: string
  type: 'physical' | 'digital'
  price: Money
  version: number
  createdAt: string
  updatedAt: string
}
export interface OrderDetail extends OrderSummary {
  shipping: Shipping | null
  snapshot: {
    listingVersion: number
    title: string
    description: string
    type: string
    category: string
    price: Money
    licenseDescription: string | null
    contentVersion: string | null
  }
}
export type OrderAction =
  'cancel' | 'pay' | 'deliver' | 'issue' | 'request-refund' | 'accept' | 'refund' | 'restore'
export function orderActions(order: OrderDetail, accountId: string): OrderAction[] {
  if (accountId === order.buyerId) {
    if (order.status === 'pending_payment') return ['pay', 'cancel']
    if (order.status === 'pending_delivery') return ['issue']
    if (order.status === 'pending_acceptance') return ['accept', 'issue']
    if (order.status === 'issue') return ['accept', 'request-refund']
  }
  if (accountId === order.sellerId) {
    if (order.status === 'pending_delivery' || order.status === 'pending_acceptance')
      return ['deliver']
    if (order.status === 'issue') return ['deliver', 'refund']
    if (order.status === 'refunded' && order.type === 'physical') return ['restore']
  }
  return []
}
