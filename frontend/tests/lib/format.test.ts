import { describe, it, expect } from 'vitest'
import { formatPrice, fiatEstimate, formatDate } from '@/lib/format'

describe('formatPrice', () => {
  it('formats CNY with symbol prefix', () => {
    expect(formatPrice(100, 'CNY')).toBe('¥100')
  })

  it('formats large CNY with thousands separator', () => {
    expect(formatPrice(6899, 'CNY')).toBe('¥6,899')
  })

  it('formats USDT with symbol prefix', () => {
    expect(formatPrice(100, 'USDT')).toBe('₮100')
  })

  it('formats ETH as "amount ETH" suffix', () => {
    expect(formatPrice(12.5, 'ETH')).toBe('12.5 ETH')
  })

  it('formats SOL as "amount SOL" suffix', () => {
    expect(formatPrice(0.5, 'SOL')).toBe('0.5 SOL')
  })

  it('respects maximumFractionDigits for fiat', () => {
    expect(formatPrice(100.456, 'CNY')).toMatch(/¥100\.46/)
  })
})

describe('fiatEstimate', () => {
  it('estimates CNY at 0.14 USD', () => {
    expect(fiatEstimate(1000, 'CNY')).toBe(140)
  })

  it('estimates USDT at 1 USD', () => {
    expect(fiatEstimate(100, 'USDT')).toBe(100)
  })

  it('estimates ETH at 3400 USD', () => {
    expect(fiatEstimate(1, 'ETH')).toBe(3400)
  })

  it('rounds to integer', () => {
    expect(fiatEstimate(7.7, 'CNY')).toBe(1) // 7.7 * 0.14 = 1.078 → 1
  })
})

describe('formatDate', () => {
  it('returns "今天" for today', () => {
    const today = new Date().toISOString()
    expect(formatDate(today)).toBe('今天')
  })

  it('returns "昨天" for yesterday', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(formatDate(yesterday)).toBe('昨天')
  })

  it('returns "N 天前" for 2-6 days ago', () => {
    const three = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatDate(three)).toBe('3 天前')
  })

  it('returns "N 周前" for 7-29 days ago', () => {
    const twoWeeks = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatDate(twoWeeks)).toBe('2 周前')
  })

  it('returns localized date for >30 days ago', () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const result = formatDate(old)
    expect(result).toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/)
  })
})