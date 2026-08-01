'use client'

import { useMemo } from 'react'
import { FilterSidebar } from '@/components/explore/filter-sidebar'
import { SortDropdown } from '@/components/explore/sort-dropdown'
import { ItemGrid } from '@/components/home/item-grid'
import { categories, items, sellers } from '@/lib/mock-data'
import { applyFilters } from '@/lib/filter'
import { useFilterStore } from '@/stores/use-filter-store'
import type { SortBy } from '@/types'

export default function ExplorePage() {
  const filter = useFilterStore()
  const sellerMap = useMemo(() => new Map(sellers.map(s => [s.id, s])), [])
  const filtered = useMemo(() => applyFilters(items, filter), [filter])

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <FilterSidebar
          categories={categories}
          filter={filter}
          onKeyword={v => filter.setKeyword(v || undefined)}
          onCategory={v => filter.setCategory(v)}
          onItemCategory={v => filter.setItemCategory(v)}
          onCurrency={v => filter.setCurrency(v)}
          onCondition={v => filter.setCondition(v)}
          onReset={() => filter.reset()}
        />
      </aside>

      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            共 <span className="font-semibold text-foreground">{filtered.length}</span> 件商品
          </div>
          <SortDropdown value={filter.sortBy} onChange={(v: SortBy) => filter.setSortBy(v)} />
        </div>

        <ItemGrid items={filtered} sellers={sellerMap} />
      </div>
    </div>
  )
}