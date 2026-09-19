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
export interface Delivery {
  id: string
  sequence: number
  kind: 'physical' | 'digital'
  reference: string
  carrier: string | null
  accessCode: string | null
  createdAt: string
}
export interface Issue {
  id: string
  description: string
  status: 'open' | 'resolved'
  createdAt: string
}
export interface Refund {
  id: string
  status: 'pending' | 'approved' | 'closed'
  returnOutcome: 'not_sent' | 'returned' | 'not_required' | 'digital' | null
  createdAt: string
}
export interface Settlement {
  id: string
  mode: 'simulated'
  operation: 'payment' | 'refund'
  price: Money
  createdAt: string
}
export interface OrderEvent {
  id: string
  operation: string
  fromState: string | null
  toState: string
  createdAt: string
}
export type OrderAction =
  'cancel' | 'pay' | 'deliver' | 'issue' | 'request-refund' | 'accept' | 'refund' | 'restore'

export function acceptanceOrderStatus(status: OrderDetail['status']) {
  if (status === 'pending_delivery') return 'PAID_HELD'
  if (status === 'pending_acceptance') return 'DELIVERED'
  return status.toUpperCase()
}

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
