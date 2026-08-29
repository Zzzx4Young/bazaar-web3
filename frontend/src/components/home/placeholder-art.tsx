import { iconForCategory, categoryForItem } from '@/lib/category-icons'
import { categories } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import type { Item, PrimaryCategory } from '@/types'

interface PlaceholderArtProps {
  item: Item
  /** When provided, overrides the catalog-derived category. Useful for empty
   *  test items that the categories list hasn't indexed yet. */
  categoryHint?: PrimaryCategory
}

/**
 * Render when an ItemCard's primary image is missing or has failed to load.
 * Visual recipe per category — see globals.css `.placeholder-*` for the
 * gradient stops. A lucide icon and the title's first character overlap.
 */
export function PlaceholderArt({ item, categoryHint }: PlaceholderArtProps) {
  const cat: PrimaryCategory | undefined =
    categoryHint ?? categoryForItem(item.id, categories)
  const Icon = iconForCategory(cat)
  // Grab the first **letter** (Unicode letter class) for the watermark. If
  // the title starts with digits / punctuation, fall back to the title's
  // first non-space character; otherwise to "?" so the layout never breaks.
  const stripped = item.title.replace(/[\s\p{P}\p{S}]/gu, '')
  const letter =
    (stripped.match(/[\p{L}\p{N}]/u)?.[0] ?? item.title[0] ?? '?').toUpperCase()

  const klass = cn(
    'flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden',
    cat ? `placeholder-${cat}` : 'placeholder-default'
  )

  return (
    <div
      role="img"
      aria-label={item.title}
      className={klass}
      data-testid="placeholder-art"
      data-category={cat ?? 'unknown'}
    >
      {/* Faint decorative letter — large, positioned to the upper-right */}
      <span
        aria-hidden
        className="select-none text-[6rem] font-black leading-none opacity-20"
        style={{ marginTop: '-8%', marginLeft: '32%' }}
      >
        {letter}
      </span>
      {/* Icon, centered, slightly toward the bottom */}
      <Icon
        className="relative -mt-12 h-12 w-12 opacity-90"
        strokeWidth={1.5}
        aria-hidden
      />
    </div>
  )
}
