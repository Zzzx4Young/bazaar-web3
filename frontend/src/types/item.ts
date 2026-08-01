// Item / 资源类型定义
// 对应 docs/mock-data-spec.md §4.1

export type ItemCategory = 'physical' | 'digital'

export type ItemStatus = 'active' | 'locked' | 'sold'

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'poor'

export type DigitalDeliveryType =
  | 'download_link'
  | 'license_key'
  | 'cloud_link'
  | 'account_credentials'

export type ShippingMethod = 'delivery' | 'face_to_face'

export type Currency = 'CNY' | 'ETH' | 'USDT' | 'SOL'

export interface Price {
  amount: number
  currency: Currency
  fiatEstimate?: number // 法币折算（USD）
}

export interface MediaItem {
  type: 'image' | 'video' | 'thumbnail'
  url: string
  alt?: string
}

export interface Item {
  id: string
  sellerId: string
  title: string
  description: string // Markdown
  category: ItemCategory
  tags: string[]
  price: Price
  originalPrice?: Price
  // 实物字段（仅 category=physical）
  condition?: ItemCondition
  shippingMethod?: ShippingMethod
  // 数字字段（仅 category=digital）
  deliveryType?: DigitalDeliveryType
  deliveryPreview?: string // 仅 seller 可见
  // 媒体
  media: MediaItem[]
  // 元信息
  status: ItemStatus
  viewCount: number
  favoriteCount: number
  createdAt: string // ISO
  updatedAt: string
}