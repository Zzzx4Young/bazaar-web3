// Category / 分类 + 筛选状态
// 对应 docs/mock-data-spec.md §4.4

import type { ItemCategory, ItemCondition, Currency } from './item'

export type PrimaryCategory =
  | 'electronics' // 电子数码
  | 'digital_assets' // 数字资产
  | 'software_source' // 软件源码
  | 'game_items' // 游戏道具
  | 'secondhand_fashion' // 二手服饰

export interface Category {
  id: PrimaryCategory
  label: string
  itemCategory: ItemCategory // 主归属（实物/数字）
  icon: string // lucide-react icon name
  subcategories?: string[]
  itemIds: string[] // mock 数据归属
}

export type SortBy = 'newest' | 'price_asc' | 'price_desc' | 'popular'

export interface FilterState {
  category?: PrimaryCategory
  itemCategory?: ItemCategory
  priceMin?: number
  priceMax?: number
  currency?: Currency
  condition?: ItemCondition
  sortBy: SortBy
  page: number
  pageSize: number
  keyword?: string
}