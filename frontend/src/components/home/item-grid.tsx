// 商品网格
import { SearchX } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Link } from '@/i18n/routing'
import { ItemCard } from './item-card'
import type { Item, Seller } from '@/types'

interface ItemGridProps {
  items: Item[]
  sellers?: Map<string, Seller>
  title?: string
  /** Defaults to "noResults" — set to any string key in emptyState.* */
  emptyVariant?: 'noResults' | 'noPublished' | 'noOrders'
}

export function ItemGrid({ items, sellers, title, emptyVariant = 'noResults' }: ItemGridProps) {
  const t = useTranslations('emptyState')
  const tCommon = useTranslations('common')

  if (items.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={t(`${emptyVariant}.title`)}
        description={t(`${emptyVariant}.description`)}
        action={
          <Button asChild variant="outline">
            <Link href="/explore">{tCommon('explore')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <section className="space-y-3">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} seller={sellers?.get(item.sellerId)} />
        ))}
      </div>
    </section>
  )
}
