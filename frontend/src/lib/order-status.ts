// 订单状态中文映射
import type { OrderStatus } from '@/types'

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: '待付款',
  pending_fulfillment: '待发货',
  pending_confirm: '待确认收货',
  completed: '已完成',
  cancelled: '已取消'
}

const STATUS_VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending_payment: 'destructive',
  pending_fulfillment: 'outline',
  pending_confirm: 'default',
  completed: 'secondary',
  cancelled: 'outline'
}

export function orderStatusLabel(status: OrderStatus): string {
  return STATUS_LABEL[status]
}

export function orderStatusVariant(status: OrderStatus) {
  return STATUS_VARIANT[status]
}