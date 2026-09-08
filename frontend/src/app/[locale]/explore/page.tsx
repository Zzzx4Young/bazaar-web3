'use client'

import { Suspense, useEffect, useMemo } from 'react'
import { FilterSidebar } from '@/components/explore/filter-sidebar'
import { SortDropdown } from '@/components/explore/sort-dropdown'
import { ItemGrid } from '@/components/home/item-grid'
import { categories, sellers } from '@/lib/mock-data'
import { applyFilters } from '@/lib/filter'
import { useFilterStore } from '@/stores/use-filter-store'
import { useItemStore } from '@/stores/use-item-store'
import { useSearchParams } from 'next/navigation'
import type { SortBy } from '@/types'

export default function ExplorePage() {
  return <Suspense fallback={<p>加载商品中...</p>}><ExploreContent /></Suspense>
}

function ExploreContent() {
  const { items } = useItemStore()
  const searchParams = useSearchParams()
  const categoryParam = searchParams.get('category')
  const filter = useFilterStore()
  const setCategory = filter.setCategory
  useEffect(() => {
    setCategory(categories.find(category => category.id === categoryParam)?.id)
  }, [categoryParam, setCategory])
  const sellerMap = useMemo(() => new Map(sellers.map(s => [s.id, s])), [])
  const filtered = useMemo(() => applyFilters(items, filter), [items, filter])

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