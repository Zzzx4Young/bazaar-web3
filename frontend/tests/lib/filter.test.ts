import { describe, it, expect } from 'vitest'
import { applyFilters } from '@/lib/filter'
import type { Item, ItemCategory, ItemStatus, ItemCondition } from '@/types'

// Minimal Item factory — only fields applyFilters reads are populated
function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: overrides.id ?? 'item_x',
    sellerId: 'seller_x',
    title: overrides.title ?? 'Sample Item',
    description: overrides.description ?? 'A description',
    category: overrides.category ?? 'physical',
    tags: overrides.tags ?? [],
    price: overrides.price ?? { amount: 100, currency: 'CNY' },
    media: [],
    status: overrides.status ?? ('active' as ItemStatus),
    viewCount: 0,
    favoriteCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

const baseFilter = {
  sortBy: 'newest' as const,
  page: 1,
  pageSize: 100
}

describe('applyFilters — keyword', () => {
  it('returns all items when keyword is empty', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })]
    const result = applyFilters(items, { ...baseFilter })
    expect(result).toHaveLength(2)
  })

  it('matches title case-insensitively', () => {
    const items = [
      makeItem({ id: 'a', title: 'iPhone 15 Pro' }),
      makeItem({ id: 'b', title: 'MacBook Air' })
    ]
    const result = applyFilters(items, { ...baseFilter, keyword: 'iphone' })
    expect(result.map(i => i.id)).toEqual(['a'])
  })

  it('matches description content', () => {
    const items = [
      makeItem({ id: 'a', description: 'Beautiful sneaker' }),
      makeItem({ id: 'b', description: 'A camera lens' })
    ]
    const result = applyFilters(items, { ...baseFilter, keyword: 'sneaker' })
    expect(result.map(i => i.id)).toEqual(['a'])
  })

  it('matches tags case-insensitively', () => {
    const items = [
      makeItem({ id: 'a', tags: ['99new', 'unboxed'] }),
      makeItem({ id: 'b', tags: ['used'] })
    ]
    const result = applyFilters(items, { ...baseFilter, keyword: '99NEW' })
    expect(result.map(i => i.id)).toEqual(['a'])
  })

  it('returns empty when no match', () => {
    const items = [makeItem({ id: 'a', title: 'iPhone' })]
    const result = applyFilters(items, { ...baseFilter, keyword: 'galaxy' })
    expect(result).toHaveLength(0)
  })

  it('ignores leading and trailing whitespace', () => {
    const items = [makeItem({ id: 'a', title: 'iPhone' })]
    const result = applyFilters(items, { ...baseFilter, keyword: '   iphone   ' })
    expect(result).toHaveLength(1)
  })
})

describe('applyFilters — category & type', () => {
  it('filters by itemCategory=physical', () => {
    const items = [
      makeItem({ id: 'p1', category: 'physical' }),
      makeItem({ id: 'd1', category: 'digital' })
    ]
    const result = applyFilters(items, { ...baseFilter, itemCategory: 'physical' as ItemCategory })
    expect(result.map(i => i.id)).toEqual(['p1'])
  })

  it('filters by itemCategory=digital', () => {
    const items = [
      makeItem({ id: 'p1', category: 'physical' }),
      makeItem({ id: 'd1', category: 'digital' })
    ]
    const result = applyFilters(items, { ...baseFilter, itemCategory: 'digital' as ItemCategory })
    expect(result.map(i => i.id)).toEqual(['d1'])
  })
})

describe('applyFilters — price range', () => {
  it('filters by priceMin', () => {
    const items = [
      makeItem({ id: 'a', price: { amount: 50, currency: 'CNY' } }),
      makeItem({ id: 'b', price: { amount: 200, currency: 'CNY' } })
    ]
    const result = applyFilters(items, { ...baseFilter, priceMin: 100 })
    expect(result.map(i => i.id)).toEqual(['b'])
  })

  it('filters by priceMax', () => {
    const items = [
      makeItem({ id: 'a', price: { amount: 50, currency: 'CNY' } }),
      makeItem({ id: 'b', price: { amount: 200, currency: 'CNY' } })
    ]
    const result = applyFilters(items, { ...baseFilter, priceMax: 100 })
    expect(result.map(i => i.id)).toEqual(['a'])
  })

  it('combines priceMin and priceMax', () => {
    const items = [
      makeItem({ id: 'a', price: { amount: 50, currency: 'CNY' } }),
      makeItem({ id: 'b', price: { amount: 150, currency: 'CNY' } }),
      makeItem({ id: 'c', price: { amount: 300, currency: 'CNY' } })
    ]
    const result = applyFilters(items, { ...baseFilter, priceMin: 100, priceMax: 200 })
    expect(result.map(i => i.id)).toEqual(['b'])
  })
})

describe('applyFilters — condition', () => {
  it('filters by condition=like_new', () => {
    const items = [
      makeItem({ id: 'a', condition: 'like_new' as ItemCondition }),
      makeItem({ id: 'b', condition: 'good' as ItemCondition })
    ]
    const result = applyFilters(items, { ...baseFilter, condition: 'like_new' as ItemCondition })
    expect(result.map(i => i.id)).toEqual(['a'])
  })

  it('does not filter digital items by condition', () => {
    const items = [makeItem({ id: 'd', category: 'digital' })]
    // digital items don't have condition — should not be filtered out
    const result = applyFilters(items, { ...baseFilter, condition: 'like_new' as ItemCondition })
    expect(result.map(i => i.id)).toEqual(['d'])
  })
})

describe('applyFilters — sort', () => {
  it('sorts by newest (createdAt desc)', () => {
    const items = [
      makeItem({ id: 'old', createdAt: '2025-01-01T00:00:00Z' }),
      makeItem({ id: 'new', createdAt: '2026-12-31T00:00:00Z' }),
      makeItem({ id: 'mid', createdAt: '2026-06-01T00:00:00Z' })
    ]
    const result = applyFilters(items, { ...baseFilter, sortBy: 'newest' })
    expect(result.map(i => i.id)).toEqual(['new', 'mid', 'old'])
  })

  it('sorts by price_asc', () => {
    const items = [
      makeItem({ id: 'mid', price: { amount: 100, currency: 'CNY' } }),
      makeItem({ id: 'cheap', price: { amount: 10, currency: 'CNY' } }),
      makeItem({ id: 'pricey', price: { amount: 500, currency: 'CNY' } })
    ]
    const result = applyFilters(items, { ...baseFilter, sortBy: 'price_asc' })
    expect(result.map(i => i.id)).toEqual(['cheap', 'mid', 'pricey'])
  })

  it('sorts by price_desc', () => {
    const items = [
      makeItem({ id: 'mid', price: { amount: 100, currency: 'CNY' } }),
      makeItem({ id: 'cheap', price: { amount: 10, currency: 'CNY' } }),
      makeItem({ id: 'pricey', price: { amount: 500, currency: 'CNY' } })
    ]
    const result = applyFilters(items, { ...baseFilter, sortBy: 'price_desc' })
    expect(result.map(i => i.id)).toEqual(['pricey', 'mid', 'cheap'])
  })

  it('sorts by popular (viewCount desc)', () => {
    const items = [
      makeItem({ id: 'low', viewCount: 10 }),
      makeItem({ id: 'high', viewCount: 1000 }),
      makeItem({ id: 'mid', viewCount: 500 })
    ]
    const result = applyFilters(items, { ...baseFilter, sortBy: 'popular' })
    expect(result.map(i => i.id)).toEqual(['high', 'mid', 'low'])
  })
})

describe('applyFilters — combined', () => {
  it('combines keyword + category + sort', () => {
    const items = [
      makeItem({ id: 'a', title: 'iPhone', category: 'physical', price: { amount: 5000, currency: 'CNY' }, viewCount: 100, createdAt: '2026-01-01T00:00:00Z' }),
      makeItem({ id: 'b', title: 'iPad', category: 'physical', price: { amount: 4000, currency: 'CNY' }, viewCount: 50, createdAt: '2026-02-01T00:00:00Z' }),
      makeItem({ id: 'c', title: 'iPhone Skin', category: 'digital', price: { amount: 5, currency: 'USDT' }, viewCount: 200, createdAt: '2026-03-01T00:00:00Z' })
    ]
    const result = applyFilters(items, {
      ...baseFilter,
      keyword: 'iphone',
      itemCategory: 'physical',
      sortBy: 'popular'
    })
    expect(result.map(i => i.id)).toEqual(['a']) // c is digital, b is iPad (no keyword match)
  })
})