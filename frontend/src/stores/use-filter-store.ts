// useFilterStore — 列表筛选状态
'use client'

import { create } from 'zustand'
import type { FilterState, SortBy, ItemCategory, PrimaryCategory, Currency, ItemCondition } from '@/types'

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
  pageSize: 12,
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
  setCategory: category => set(state => ({ ...state, category, page: 1 })),
  setItemCategory: itemCategory => set(state => ({ ...state, itemCategory, page: 1 })),
  setPriceRange: (priceMin, priceMax) => set(state => ({ ...state, priceMin, priceMax, page: 1 })),
  setCurrency: currency => set(state => ({ ...state, currency, page: 1 })),
  setCondition: condition => set(state => ({ ...state, condition, page: 1 })),
  setSortBy: sortBy => set(state => ({ ...state, sortBy, page: 1 })),
  setKeyword: keyword => set(state => ({ ...state, keyword, page: 1 })),
  setPage: page => set(state => ({ ...state, page })),
  reset: () => set(state => ({ ...state, ...defaultState })),
}))