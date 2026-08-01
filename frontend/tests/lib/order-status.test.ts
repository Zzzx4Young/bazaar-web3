import { describe, it, expect } from 'vitest'
import { orderStatusLabel, orderStatusVariant } from '@/lib/order-status'
import type { OrderStatus } from '@/types'

describe('orderStatusLabel', () => {
  it('labels pending_payment as 待付款', () => {
    expect(orderStatusLabel('pending_payment' as OrderStatus)).toBe('待付款')
  })

  it('labels pending_fulfillment as 待发货', () => {
    expect(orderStatusLabel('pending_fulfillment' as OrderStatus)).toBe('待发货')
  })

  it('labels pending_confirm as 待确认收货', () => {
    expect(orderStatusLabel('pending_confirm' as OrderStatus)).toBe('待确认收货')
  })

  it('labels completed as 已完成', () => {
    expect(orderStatusLabel('completed' as OrderStatus)).toBe('已完成')
  })

  it('labels cancelled as 已取消', () => {
    expect(orderStatusLabel('cancelled' as OrderStatus)).toBe('已取消')
  })
})

describe('orderStatusVariant', () => {
  it('uses destructive variant for pending_payment (urgent)', () => {
    expect(orderStatusVariant('pending_payment' as OrderStatus)).toBe('destructive')
  })

  it('uses outline variant for pending_fulfillment', () => {
    expect(orderStatusVariant('pending_fulfillment' as OrderStatus)).toBe('outline')
  })

  it('uses default variant for pending_confirm', () => {
    expect(orderStatusVariant('pending_confirm' as OrderStatus)).toBe('default')
  })

  it('uses secondary variant for completed', () => {
    expect(orderStatusVariant('completed' as OrderStatus)).toBe('secondary')
  })

  it('uses outline variant for cancelled', () => {
    expect(orderStatusVariant('cancelled' as OrderStatus)).toBe('outline')
  })
})