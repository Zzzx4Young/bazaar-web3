import { describe, it, expect } from 'vitest'
import { findItem, findSeller, itemsByCategory } from '@/lib/mock-data'

describe('findItem', () => {
  it('returns the item when id exists', () => {
    const item = findItem('item_001')
    expect(item?.id).toBe('item_001')
    expect(item?.title).toBeTruthy()
  })

  it('returns undefined when id does not exist', () => {
    expect(findItem('item_does_not_exist')).toBeUndefined()
  })
})

describe('findSeller', () => {
  it('returns the seller when id exists', () => {
    const seller = findSeller('seller_001')
    expect(seller?.id).toBe('seller_001')
    expect(seller?.displayName).toBeTruthy()
  })

  it('returns undefined when id does not exist', () => {
    expect(findSeller('seller_does_not_exist')).toBeUndefined()
  })
})

describe('itemsByCategory', () => {
  it('returns all items in electronics category', () => {
    const electronics = itemsByCategory('electronics')
    expect(electronics.length).toBeGreaterThan(0)
    for (const item of electronics) {
      expect(item.category).toBe('physical') // electronics are all physical in our mock
    }
  })

  it('returns all items in digital_assets category', () => {
    const digital = itemsByCategory('digital_assets')
    expect(digital.length).toBeGreaterThan(0)
    for (const item of digital) {
      expect(item.category).toBe('digital')
    }
  })

  it('returns all items in software_source category', () => {
    const source = itemsByCategory('software_source')
    expect(source.length).toBeGreaterThan(0)
  })

  it('returns all items in game_items category', () => {
    const games = itemsByCategory('game_items')
    expect(games.length).toBeGreaterThan(0)
  })

  it('returns all items in secondhand_fashion category', () => {
    const fashion = itemsByCategory('secondhand_fashion')
    expect(fashion.length).toBeGreaterThan(0)
    for (const item of fashion) {
      expect(item.category).toBe('physical')
    }
  })

  it('total items across all categories equals mock dataset size', () => {
    const cats: Array<'electronics' | 'digital_assets' | 'software_source' | 'game_items' | 'secondhand_fashion'> = [
      'electronics', 'digital_assets', 'software_source', 'game_items', 'secondhand_fashion'
    ]
    const total = cats.reduce((sum, cat) => sum + itemsByCategory(cat).length, 0)
    // 5 items per category × 5 categories = 25 items
    expect(total).toBe(25)
  })
})