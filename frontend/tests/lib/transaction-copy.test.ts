import { expect, test } from 'vitest'
import { transactionConsequence, transactionLabel } from '@/lib/transaction-copy'

test('order and settlement states use readable labels in both supported locales', () => {
  for (const value of ['pending_payment', 'pending_delivery', 'pending_acceptance', 'issue',
    'completed', 'cancelled', 'expired', 'refunded', 'payment', 'release', 'request_refund',
    'active', 'locked', 'sold', 'create']) {
    expect(transactionLabel(value, 'zh-CN')).not.toBe(value)
    expect(transactionLabel(value, 'en')).not.toBe(value)
  }
  for (const action of ['pay', 'accept', 'request-refund', 'refund', 'release']) {
    expect(transactionConsequence(action, 'zh-CN')).toBeTruthy()
    expect(transactionConsequence(action, 'en')).toBeTruthy()
  }
})
