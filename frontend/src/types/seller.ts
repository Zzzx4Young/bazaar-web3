// Seller / 卖家公开信息
// 对应 docs/mock-data-spec.md §4.2

export interface Seller {
  id: string
  displayName: string
  avatarSeed: string // 用于 boring-avatars / dicebear
  joinedAt: string // ISO
  completedOrders: number
  rating: number // 1-5
  ratingCount: number
  activeItemIds: string[]
}