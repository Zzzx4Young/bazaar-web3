import { marketplaceCategories } from '@/lib/categories'
import { EXPLORE_PAGE_SIZE, paginationPolicy } from '@/lib/pagination'
import type { FilterState, ItemCategory, PrimaryCategory, SortBy } from '@/types'

const sorts: SortBy[] = ['newest', 'price_asc', 'price_desc']

export function parseExploreQuery(params: URLSearchParams): FilterState {
  const category = marketplaceCategories.find((entry) => entry.id === params.get('category'))
  const rawType = params.get('type')
  const itemCategory: ItemCategory | undefined =
    rawType === 'physical' || rawType === 'digital' ? rawType : undefined
  const rawSort = params.get('sort')
  const rawPage = Number(params.get('page'))
  const rawCurrency = params.get('currency')
  return {
    category: category && (!itemCategory || category.itemCategory === itemCategory)
      ? category.id
      : undefined,
    itemCategory,
    keyword: params.get('keyword')?.slice(0, 200) || undefined,
    currency: rawCurrency && /^[A-Z]{3,5}$/.test(rawCurrency) ? rawCurrency : undefined,
    sortBy: sorts.includes(rawSort as SortBy) ? rawSort as SortBy : 'newest',
    page: Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= paginationPolicy.maxPage
      ? rawPage
      : 1,
    pageSize: EXPLORE_PAGE_SIZE
  }
}

export function serializeExploreQuery(filter: FilterState): string {
  const params = new URLSearchParams()
  if (filter.category) params.set('category', filter.category)
  if (filter.itemCategory) params.set('type', filter.itemCategory)
  if (filter.keyword?.trim()) params.set('keyword', filter.keyword)
  if (filter.currency) params.set('currency', filter.currency)
  if (filter.sortBy !== 'newest') params.set('sort', filter.sortBy)
  if (filter.page > 1) params.set('page', String(filter.page))
  return params.toString()
}

export function categoryForType(
  category: PrimaryCategory | undefined,
  itemCategory: ItemCategory | undefined
): PrimaryCategory | undefined {
  if (!category || !itemCategory) return category
  return marketplaceCategories.find((entry) => entry.id === category)?.itemCategory === itemCategory
    ? category
    : undefined
}
