import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '@/stores/use-filter-store'
import type { SortBy } from '@/types'

// Reset store to default between tests
beforeEach(() => {
  useFilterStore.getState().reset()
})

describe('useFilterStore — default state', () => {
  it('initializes with sortBy=newest, page=1, pageSize=12', () => {
    const state = useFilterStore.getState()
    expect(state.sortBy).toBe('newest')
    expect(state.page).toBe(1)
    expect(state.pageSize).toBe(12)
  })

  it('initializes with no filter fields set', () => {
    const state = useFilterStore.getState()
    expect(state.category).toBeUndefined()
    expect(state.itemCategory).toBeUndefined()
    expect(state.keyword).toBeUndefined()
    expect(state.priceMin).toBeUndefined()
    expect(state.priceMax).toBeUndefined()
    expect(state.currency).toBeUndefined()
    expect(state.condition).toBeUndefined()
  })
})

describe('useFilterStore — setters', () => {
  it('setCategory updates category and resets page to 1', () => {
    useFilterStore.getState().setPage(5)
    useFilterStore.getState().setCategory('electronics')
    const state = useFilterStore.getState()
    expect(state.category).toBe('electronics')
    expect(state.page).toBe(1)
  })

  it('setItemCategory updates itemCategory and resets page', () => {
    useFilterStore.getState().setPage(3)
    useFilterStore.getState().setItemCategory('physical')
    const state = useFilterStore.getState()
    expect(state.itemCategory).toBe('physical')
    expect(state.page).toBe(1)
  })

  it('setItemCategory accepts undefined to clear filter', () => {
    useFilterStore.getState().setItemCategory('physical')
    useFilterStore.getState().setItemCategory(undefined)
    expect(useFilterStore.getState().itemCategory).toBeUndefined()
  })

  it('setPriceRange sets both min and max', () => {
    useFilterStore.getState().setPriceRange(100, 500)
    const state = useFilterStore.getState()
    expect(state.priceMin).toBe(100)
    expect(state.priceMax).toBe(500)
  })

  it('setCurrency updates currency', () => {
    useFilterStore.getState().setCurrency('ETH')
    expect(useFilterStore.getState().currency).toBe('ETH')
  })

  it('setCondition updates condition', () => {
    useFilterStore.getState().setCondition('like_new')
    expect(useFilterStore.getState().condition).toBe('like_new')
  })

  it('setSortBy updates sortBy and resets page', () => {
    useFilterStore.getState().setPage(4)
    useFilterStore.getState().setSortBy('price_asc' as SortBy)
    expect(useFilterStore.getState().sortBy).toBe('price_asc')
    expect(useFilterStore.getState().page).toBe(1)
  })

  it('setKeyword updates keyword', () => {
    useFilterStore.getState().setKeyword('iphone')
    expect(useFilterStore.getState().keyword).toBe('iphone')
  })

  it('setKeyword accepts undefined to clear', () => {
    useFilterStore.getState().setKeyword('iphone')
    useFilterStore.getState().setKeyword(undefined)
    expect(useFilterStore.getState().keyword).toBeUndefined()
  })
})

describe('useFilterStore — setPage does NOT reset page', () => {
  it('setPage does not affect other fields', () => {
    useFilterStore.getState().setCategory('electronics')
    useFilterStore.getState().setPage(3)
    const state = useFilterStore.getState()
    expect(state.category).toBe('electronics')
    expect(state.page).toBe(3)
  })
})

describe('useFilterStore — reset', () => {
  it('reset returns all fields to defaults', () => {
    useFilterStore.getState().setCategory('electronics')
    useFilterStore.getState().setItemCategory('physical')
    useFilterStore.getState().setKeyword('test')
    useFilterStore.getState().setSortBy('popular' as SortBy)
    useFilterStore.getState().setPage(5)

    useFilterStore.getState().reset()

    const state = useFilterStore.getState()
    expect(state.category).toBeUndefined()
    expect(state.itemCategory).toBeUndefined()
    expect(state.keyword).toBeUndefined()
    expect(state.sortBy).toBe('newest')
    expect(state.page).toBe(1)
    expect(state.pageSize).toBe(12)
  })
})