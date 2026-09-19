// 价格格式化工具
import type { Currency } from '@/types'

const CURRENCY_SYMBOL: Partial<Record<Currency, string>> = {
  CNY: '¥',
  USDT: '₮',
  ETH: 'Ξ',
  SOL: '◎'
}

const FIAT_RATE: Partial<Record<Currency, number>> = {
  CNY: 1,
  USDT: 7.2,
  ETH: 3400,
  SOL: 150
}

export function formatPrice(amount: number | string, currency: Currency): string {
  if (typeof amount === 'number' && !Number.isFinite(amount)) return `— ${currency}`
  if (typeof amount === 'string' && amount.trim().toLowerCase() === 'nan') return `— ${currency}`
  if (currency === 'BTC' || currency === 'ETH' || currency === 'SOL') {
    return `${amount} ${currency}`
  }
  const symbol = CURRENCY_SYMBOL[currency]
  const formatted =
    typeof amount === 'string'
      ? amount
      : amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return `${symbol ?? currency}${formatted}`
}

export function fiatEstimate(amount: number, currency: Currency): number {
  const usdRate = currency === 'CNY' ? 0.14 : currency === 'USDT' ? 1 : 3400
  return Math.round(amount * usdRate)
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`
  return d.toLocaleDateString('zh-CN')
}
