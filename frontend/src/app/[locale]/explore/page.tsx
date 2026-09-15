'use client'

import { Suspense, useEffect, useMemo } from 'react'
import { FilterSidebar } from '@/components/explore/filter-sidebar'
import { SortDropdown } from '@/components/explore/sort-dropdown'
import { ItemGrid } from '@/components/home/item-grid'
import { marketplaceCategories } from '@/lib/categories'
import { applyFilters } from '@/lib/filter'
import { useFilterStore } from '@/stores/use-filter-store'
import { useSearchParams } from 'next/navigation'
import type { SortBy } from '@/types'
import { useBackendListings } from '@/hooks/use-backend-listings'

export default function ExplorePage() {
  return (
    <Suspense fallback={<p>加载商品中...</p>}>
      <ExploreContent />
    </Suspense>
  )
}

function ExploreContent() {
  const searchParams = useSearchParams()
  const categoryParam = searchParams.get('category')
  const filter = useFilterStore()
  const setCategory = filter.setCategory
  useEffect(() => {
    setCategory(marketplaceCategories.find((category) => category.id === categoryParam)?.id)
  }, [categoryParam, setCategory])
  const backendParams = useMemo(() => {
    const params = new URLSearchParams({
      sort: filter.sortBy,
      limit: '50'
    })
    if (filter.category) params.set('category', filter.category)
    return params
  }, [filter.category, filter.sortBy])
  const backend = useBackendListings(backendParams)
  const filtered = useMemo(
    () => applyFilters(backend.items, filter, { sort: false }),
    [backend.items, filter]
  )

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <FilterSidebar
          categories={marketplaceCategories}
          filter={filter}
          onKeyword={(v) => filter.setKeyword(v || undefined)}
          onCategory={(v) => filter.setCategory(v)}
          onItemCategory={(v) => filter.setItemCategory(v)}
          onCurrency={(v) => filter.setCurrency(v)}
          onReset={() => filter.reset()}
        />
      </aside>

      <div className="flex-1 space-y-4">
        {backend.error && (
          <p role="alert" className="text-sm text-destructive">
            商品加载失败：{backend.error}
          </p>
        )}
        {backend.loading && <p role="status">正在从服务端加载商品…</p>}
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            共 <span className="font-semibold text-foreground">{filtered.length}</span> 件商品
          </div>
          <SortDropdown value={filter.sortBy} onChange={(v: SortBy) => filter.setSortBy(v)} />
        </div>

        {!backend.loading && <ItemGrid items={filtered} />}
      </div>
    </div>
  )
}
