// 商品网格
import { ItemCard } from './item-card'
import type { Item, Seller } from '@/types'

interface ItemGridProps {
  items: Item[]
  sellers: Map<string, Seller>
  title?: string
}

export function ItemGrid({ items, sellers, title }: ItemGridProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        暂无商品
      </div>
    )
  }

  return (
    <section className="space-y-3">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map(item => (
          <ItemCard
            key={item.id}
            item={item}
            seller={sellers.get(item.sellerId)}
          />
        ))}
      </div>
    </section>
  )
}