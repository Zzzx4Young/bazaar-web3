import { z } from 'zod'
import type { Item } from '@/types'

const price = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z.enum(['CNY', 'ETH', 'USDT', 'SOL']),
  fiatEstimate: z.number().finite().nonnegative().optional()
})
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)))
const item = z.object({
  id: z.string().min(1),
  sellerId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  category: z.enum(['physical', 'digital']),
  primaryCategory: z
    .enum(['electronics', 'digital_assets', 'software_source', 'game_items', 'secondhand_fashion'])
    .optional(),
  tags: z.array(z.string()),
  price,
  originalPrice: price.optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor']).optional(),
  shippingMethod: z.enum(['delivery', 'face_to_face']).optional(),
  deliveryType: z
    .enum(['download_link', 'license_key', 'cloud_link', 'account_credentials'])
    .optional(),
  deliveryPreview: z.string().optional(),
  media: z.array(
    z.object({
      type: z.enum(['image', 'video', 'thumbnail']),
      url: z.string(),
      alt: z.string().optional()
    })
  ),
  status: z.enum(['active', 'locked', 'sold']),
  viewCount: z.number().finite().nonnegative(),
  favoriteCount: z.number().finite().nonnegative(),
  createdAt: date,
  updatedAt: date
})

// Keep valid legacy entries (primaryCategory may be absent). Never rewrite the
// stored payload during recovery, so rejected entries remain available to inspect.
export function decodeItemCache(value: unknown): Item[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const parsed = item.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}
