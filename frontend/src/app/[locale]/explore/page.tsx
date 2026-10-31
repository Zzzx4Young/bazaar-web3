'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { FilterSidebar } from '@/components/explore/filter-sidebar'
import { SortDropdown } from '@/components/explore/sort-dropdown'
import { ItemGrid } from '@/components/home/item-grid'
import { marketplaceCategories } from '@/lib/categories'
import { useSearchParams } from 'next/navigation'
import type { FilterState, SortBy } from '@/types'
import { useBackendListings } from '@/hooks/use-backend-listings'
import { Pagination } from '@/components/explore/pagination'
import { useTranslations } from 'next-intl'
import { categoryForType, parseExploreQuery, serializeExploreQuery } from '@/lib/explore-query'

function writeExploreUrl(filter: FilterState, quoteId: string | null, replace = false) {
  const params = new URLSearchParams(serializeExploreQuery(filter))
  if (filter.page > 1 && filter.sortBy.startsWith('price_') && quoteId)
    params.set('quoteId', quoteId)
  const serialized = params.toString()
  const url = `${window.location.pathname}${serialized ? `?${serialized}` : ''}`
  window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url)
}

export default function ExplorePage() {
  const t = useTranslations('explore')
  return (
    <Suspense fallback={<p>{t('loading')}</p>}>
      <ExploreContent />
    </Suspense>
  )
}

function ExploreContent() {
  const t = useTranslations('explore')
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const linkedQuoteId = searchParams.get('quoteId')
  const [filter, setFilter] = useState<FilterState>(() => parseExploreQuery(searchParams))
  useEffect(() => {
    setFilter(parseExploreQuery(new URLSearchParams(query)))
  }, [query])
  const updateFilter = (next: FilterState, replace = false) => {
    setFilter(next)
    writeExploreUrl(next, backend.quoteId, replace)
  }
  const backendParams = useMemo(() => {
    const params = new URLSearchParams({
      sort: filter.sortBy,
      limit: String(filter.pageSize),
      page: String(filter.page)
    })
    if (filter.category) params.set('category', filter.category)
    if (filter.itemCategory) params.set('type', filter.itemCategory)
    if (filter.currency) params.set('currency', filter.currency)
    if (filter.keyword?.trim()) params.set('keyword', filter.keyword.trim())
    if (filter.page > 1 && filter.sortBy.startsWith('price_') && linkedQuoteId)
      params.set('quoteId', linkedQuoteId)
    return params
  }, [
    filter.category,
    filter.currency,
    filter.itemCategory,
    filter.keyword,
    filter.page,
    filter.pageSize,
    filter.sortBy,
    linkedQuoteId
  ])
  const backend = useBackendListings(backendParams)
  const totalPages = Math.max(1, Math.ceil(backend.total / filter.pageSize))
  useEffect(() => {
    if (!backend.loading && !backend.error && backend.page === filter.page && filter.page > totalPages) {
      const next = { ...filter, page: totalPages }
      setFilter(next)
      writeExploreUrl(next, backend.quoteId, true)
    }
  }, [backend.loading, backend.error, backend.page, backend.quoteId, filter, totalPages])

  return (
    <div className="space-y-8">
      <header className="space-y-3 border-b border-border pb-7">
        <p className="market-eyebrow">{t('editorial.collection')}</p>
        <h1 className="market-heading text-4xl sm:text-5xl">{t('title')}</h1>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          {t('subtitle')}
        </p>
      </header>
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <FilterSidebar
            categories={marketplaceCategories}
            filter={filter}
            onKeyword={(value) => updateFilter({ ...filter, keyword: value || undefined, page: 1 }, true)}
            onCategory={(category) => updateFilter({
              ...filter,
              category,
              itemCategory: category && filter.itemCategory &&
                marketplaceCategories.find((entry) => entry.id === category)?.itemCategory !== filter.itemCategory
                ? undefined : filter.itemCategory,
              page: 1
            })}
            onItemCategory={(itemCategory) => updateFilter({
              ...filter,
              itemCategory,
              category: categoryForType(filter.category, itemCategory),
              page: 1
            })}
            onCurrency={(currency) => updateFilter({ ...filter, currency, page: 1 })}
            onReset={() => updateFilter(parseExploreQuery(new URLSearchParams()))}
          />
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          {backend.error && (
            <p role="alert" className="text-sm text-destructive">
              {t('loadError', { error: backend.error })}
            </p>
          )}
          {backend.loading && <p role="status">{t('loading')}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div className="text-sm text-muted-foreground">
              {t('count', { count: backend.total })}
            </div>
            <SortDropdown value={filter.sortBy} onChange={(sortBy: SortBy) => updateFilter({ ...filter, sortBy, page: 1 })} />
          </div>

          {!backend.loading && <ItemGrid items={backend.items} />}
          {!backend.loading && backend.total > 0 && (
            <Pagination
              page={filter.page}
              pageSize={filter.pageSize}
              total={backend.total}
              onPageChange={(page) => updateFilter({ ...filter, page })}
            />
          )}
        </div>
      </div>
    </div>
  )
}
