// useFilterStore — 列表筛选状态
'use client'

import { create } from 'zustand'
import type { FilterState, SortBy, ItemCategory, PrimaryCategory, Currency, ItemCondition } from '@/types'
import { marketplaceCategories } from '@/lib/categories'
import { EXPLORE_PAGE_SIZE } from '@/lib/pagination'

interface FilterStore extends FilterState {
  setCategory: (category?: PrimaryCategory) => void
  setItemCategory: (itemCategory?: ItemCategory) => void
  setPriceRange: (min?: number, max?: number) => void
  setCurrency: (currency?: Currency) => void
  setCondition: (condition?: ItemCondition) => void
  setSortBy: (sortBy: SortBy) => void
  setKeyword: (keyword?: string) => void
  setPage: (page: number) => void
  reset: () => void
}

const defaultState: FilterState = {
  sortBy: 'newest',
  page: 1,
  pageSize: EXPLORE_PAGE_SIZE,
  category: undefined,
  itemCategory: undefined,
  keyword: undefined,
  priceMin: undefined,
  priceMax: undefined,
  currency: undefined,
  condition: undefined
}

export const useFilterStore = create<FilterStore>(set => ({
  ...defaultState,
  setCategory: category => set(state => ({
    ...state, category, page: 1,
    itemCategory: category && state.itemCategory &&
      marketplaceCategories.find((entry) => entry.id === category)?.itemCategory !== state.itemCategory
      ? undefined : state.itemCategory
  })),
  setItemCategory: itemCategory => set(state => ({
    ...state, itemCategory, page: 1,
    category: state.category && itemCategory &&
      marketplaceCategories.find((entry) => entry.id === state.category)?.itemCategory !== itemCategory
      ? undefined : state.category,
    condition: itemCategory === 'physical' ? state.condition : undefined
  })),
  setPriceRange: (priceMin, priceMax) => set(state => ({ ...state, priceMin, priceMax, page: 1 })),
  setCurrency: currency => set(state => ({ ...state, currency, page: 1 })),
  setCondition: condition => set(state => ({ ...state, condition, page: 1 })),
  setSortBy: sortBy => set(state => ({ ...state, sortBy, page: 1 })),
  setKeyword: keyword => set(state => ({ ...state, keyword, page: 1 })),
  setPage: page => set(state => ({ ...state, page })),
  reset: () => set(state => ({ ...state, ...defaultState })),
}))
