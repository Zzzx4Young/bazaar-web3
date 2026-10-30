import { describe, expect, it } from 'vitest'
import { parseExploreQuery, serializeExploreQuery } from '@/lib/explore-query'

describe('explore query', () => {
  it('restores shareable category, type, sort, page, keyword and currency', () => {
    const query = new URLSearchParams('category=electronics&type=physical&sort=price_asc&page=3&keyword=%20camera%20&currency=CNY')
    const filter = parseExploreQuery(query)
    expect(filter).toMatchObject({
      category: 'electronics', itemCategory: 'physical', sortBy: 'price_asc',
      page: 3, keyword: ' camera ', currency: 'CNY'
    })
    expect(parseExploreQuery(new URLSearchParams(serializeExploreQuery(filter)))).toEqual(filter)
  })

  it('discards invalid values and conflicting category/type pairs', () => {
    const filter = parseExploreQuery(new URLSearchParams(
      'category=electronics&type=digital&sort=unknown&page=999999&currency=bad'
    ))
    expect(filter.category).toBeUndefined()
    expect(filter.itemCategory).toBe('digital')
    expect(filter.sortBy).toBe('newest')
    expect(filter.page).toBe(1)
    expect(filter.currency).toBeUndefined()
  })
})
