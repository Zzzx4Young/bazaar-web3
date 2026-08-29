import {
  Smartphone,
  Coins,
  Code2,
  Gamepad2,
  Shirt,
  ImageOff
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PrimaryCategory } from '@/types'

/**
 * Map a PrimaryCategory id to a lucide icon name. Falls back to ImageOff when
 * an item has no category match (e.g. user-published items orphaned from the
 * categories catalog).
 */
export function iconForCategory(cat: PrimaryCategory | undefined): LucideIcon {
  if (!cat) return ImageOff
  switch (cat) {
    case 'electronics':         return Smartphone
    case 'digital_assets':      return Coins
    case 'software_source':     return Code2
    case 'game_items':          return Gamepad2
    case 'secondhand_fashion':  return Shirt
  }
}

/**
 * Look up an item's PrimaryCategory from the categories catalog by walking
 * `itemIds`. Returns undefined for items that don't appear in any category
 * (e.g. user-published items created before the catalog caught up).
 */
export function categoryForItem(
  itemId: string,
  categories: { id: PrimaryCategory; itemIds: string[] }[]
): PrimaryCategory | undefined {
  return categories.find(c => c.itemIds.includes(itemId))?.id
}
