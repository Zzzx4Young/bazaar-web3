// Mock data loader — 静态导入 + 类型校验
import itemsJson from '@/mock/items.json'
import sellersJson from '@/mock/sellers.json'
import ordersJson from '@/mock/orders.json'
import bannersJson from '@/mock/banners.json'
import categoriesJson from '@/mock/categories.json'
import currentUserJson from '@/mock/current-user.json'

import type {
  Item,
  Seller,
  Order,
  Banner,
  Category,
  User,
  PrimaryCategory
} from '@/types'

export const items: Item[] = itemsJson as Item[]
export const sellers: Seller[] = sellersJson as Seller[]
export const orders: Order[] = ordersJson as Order[]
export const banners: Banner[] = bannersJson as Banner[]
export const categories: Category[] = categoriesJson as Category[]
export const currentUser: User = currentUserJson as User

// Helper: 通过 id 查 item
export function findItem(id: string): Item | undefined {
  return items.find(i => i.id === id)
}

// Helper: 通过 id 查 seller
export function findSeller(id: string): Seller | undefined {
  return sellers.find(s => s.id === id)
}

// Helper: 通过 category 查 items
export function itemsByCategory(category: PrimaryCategory): Item[] {
  return items.filter(i => {
    const cat = categories.find(c => c.id === category)
    return cat?.itemIds.includes(i.id)
  })
}