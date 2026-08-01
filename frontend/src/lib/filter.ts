// 列表筛选纯函数
import type { Item, FilterState } from '@/types'

export function applyFilters(items: Item[], filter: FilterState): Item[] {
  let result = [...items]

  // 关键词
  if (filter.keyword && filter.keyword.trim()) {
    const kw = filter.keyword.trim().toLowerCase()
    result = result.filter(
      i =>
        i.title.toLowerCase().includes(kw) ||
        i.description.toLowerCase().includes(kw) ||
        i.tags.some(t => t.toLowerCase().includes(kw))
    )
  }

  // 实物/数字
  if (filter.itemCategory) {
    result = result.filter(i => i.category === filter.itemCategory)
  }

  // 一级分类
  if (filter.category) {
    result = result.filter(i => {
      // 通过 tags 模糊匹配（mock 数据用 category 字段直接过滤）
      // 真实场景应通过 seller 关联，但这里直接按 category 字段
      return true
    })
    // 简化：通过 primaryCategory → itemCategory 过滤
    const categoryMap: Record<string, 'physical' | 'digital'> = {
      electronics: 'physical',
      digital_assets: 'digital',
      software_source: 'digital',
      game_items: 'digital',
      secondhand_fashion: 'physical'
    }
    const targetCat = categoryMap[filter.category]
    if (targetCat) {
      result = result.filter(i => i.category === targetCat)
    }
  }

  // 价格区间
  if (filter.priceMin !== undefined) {
    result = result.filter(i => i.price.amount >= filter.priceMin!)
  }
  if (filter.priceMax !== undefined) {
    result = result.filter(i => i.price.amount <= filter.priceMax!)
  }

  // 币种
  if (filter.currency) {
    result = result.filter(i => i.price.currency === filter.currency)
  }

  // 物品成色（仅实物）
  if (filter.condition) {
    result = result.filter(i => i.condition === filter.condition)
  }

  // 排序
  switch (filter.sortBy) {
    case 'price_asc':
      result.sort((a, b) => a.price.amount - b.price.amount)
      break
    case 'price_desc':
      result.sort((a, b) => b.price.amount - a.price.amount)
      break
    case 'popular':
      result.sort((a, b) => b.viewCount - a.viewCount)
      break
    case 'newest':
    default:
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  return result
}

export function paginate<T>(arr: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return arr.slice(start, start + pageSize)
}