const zh = {
  pending_payment: '待付款', pending_delivery: '待交付', pending_acceptance: '待验收',
  issue: '争议处理中', completed: '已完成', cancelled: '已取消', expired: '已过期',
  refunded: '已退款', published: '已发布', withdrawn: '已下架',
  open: '处理中', resolved: '已解决', pending: '待处理', approved: '已批准', closed: '已关闭',
  returned: '已退回卖家', not_sent: '尚未发货', not_required: '无需退回', digital: '数字交付',
  payment: '付款', refund: '退款', release: '放款', create: '创建订单', created: '创建订单',
  pay: '确认付款', cancel: '取消订单', deliver: '提交交付', accept: '确认验收',
  'request-refund': '申请退款', request_refund: '申请退款', counteroffer: '提出解决方案',
  restore: '恢复可售', withdraw: '下架', review: '评价', expire: '订单过期',
  resolve_refund: '裁决退款', resolve_release: '裁决放款',
  active: '在售', locked: '暂不可购买', sold: '已售出'
} as const

const en: Record<keyof typeof zh, string> = {
  pending_payment: 'Awaiting payment', pending_delivery: 'Awaiting delivery',
  pending_acceptance: 'Awaiting acceptance', issue: 'Dispute in progress',
  completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired', refunded: 'Refunded',
  published: 'Published', withdrawn: 'Withdrawn', open: 'Open', resolved: 'Resolved',
  pending: 'Pending', approved: 'Approved', closed: 'Closed', returned: 'Returned to seller',
  not_sent: 'Not shipped', not_required: 'Return not required', digital: 'Digital delivery',
  payment: 'Payment', refund: 'Refund', release: 'Release funds', create: 'Order created', created: 'Order created',
  pay: 'Confirm payment', cancel: 'Cancel order', deliver: 'Submit delivery',
  accept: 'Accept delivery', 'request-refund': 'Request refund', request_refund: 'Request refund',
  counteroffer: 'Propose resolution', restore: 'Restore availability', withdraw: 'Withdraw',
  review: 'Review', expire: 'Order expired', resolve_refund: 'Refund ruling',
  resolve_release: 'Release ruling', active: 'Available', locked: 'Unavailable', sold: 'Sold'
}

export function transactionLabel(value: string | null, locale: string): string {
  if (!value) return locale === 'en' ? 'Created' : '已创建'
  const dictionary: Record<string, string> = locale === 'en' ? en : zh
  return dictionary[value] ?? value.replaceAll('_', ' ').replaceAll('-', ' ')
}

export function transactionActionLabel(action: string, locale: string) {
  if (action === 'issue') return locale === 'en' ? 'Report a problem' : '报告问题'
  return transactionLabel(action, locale)
}

const consequences: Record<string, [string, string]> = {
  pay: ['将从模拟余额扣款，并把金额托管至验收或裁决。', 'This deducts your simulated balance and holds the amount until acceptance or resolution.'],
  accept: ['确认验收后会完成订单并向卖家放款。', 'Accepting completes the order and releases funds to the seller.'],
  'request-refund': ['申请退款后，卖家或管理员会处理争议。', 'The seller or an admin will review your refund request.'],
  refund: ['退款会关闭争议，并把模拟款项退还买家。', 'Refunding closes the dispute and returns simulated funds to the buyer.'],
  release: ['裁决放款会关闭争议，并把模拟款项发给卖家。', 'Releasing funds closes the dispute and pays the seller.']
}

export function transactionConsequence(action: string, locale: string) {
  const pair = consequences[action]
  return pair?.[locale === 'en' ? 1 : 0]
}
