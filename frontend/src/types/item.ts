// Item view model derived from the Alpha listing API.

export type ItemCategory = 'physical' | 'digital'

export type ItemStatus = 'active' | 'locked' | 'sold'

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'poor'

export type DigitalDeliveryType =
  'download_link' | 'license_key' | 'cloud_link' | 'account_credentials'

export type ShippingMethod = 'delivery' | 'face_to_face'

// Supported codes are returned by /api/currencies; the backend owns membership.
export type Currency = string

export interface Price {
  amount: number
  exactAmount?: string
  currency: Currency
  fiatEstimate?: number // 法币折算（USD）
}

export interface MediaItem {
  type: 'image' | 'video' | 'thumbnail'
  url: string
  alt?: string
}

export interface Item {
  primaryCategory?: import('./category').PrimaryCategory
  id: string
  backendVersion?: number
  sellerId: string
  sellerDisplayName?: string
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
  licenseDescription?: string
  contentVersion?: string
  // 媒体
  media: MediaItem[]
  illustrativeImage?: boolean
  // 元信息
  status: ItemStatus
  // These metrics are absent until an API supplies measured values.
  viewCount?: number
  favoriteCount?: number
  createdAt: string // ISO
  updatedAt: string
}
