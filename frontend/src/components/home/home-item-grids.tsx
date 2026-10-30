'use client'

import { useTranslations } from 'next-intl'
import { ItemGrid } from './item-grid'
import { useApiResource } from '@/hooks/use-api-resource'
import { toItem, type BackendListing } from '@/lib/backend-api'
import { AlphaHero } from './alpha-hero'
import { Link } from '@/i18n/routing'

interface HomeListings {
  featured: BackendListing[]
  digital: BackendListing[]
  physical: BackendListing[]
}

export function HomeItemGrids() {
  const backend = useApiResource<HomeListings>('/listings/home')
  const t = useTranslations('home')
  if (backend.loading)
    return (
      <div className="space-y-8">
        <AlphaHero />
        <p role="status">{t('loading')}</p>
        <PhysicalEntry />
      </div>
    )
  if (backend.error)
    return (
      <div className="space-y-8">
        <AlphaHero />
        <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
          {t('loadError')}：{backend.error}
        </p>
        <PhysicalEntry />
      </div>
    )
  const featured = backend.data?.featured.map(toItem) ?? []
  const digital = backend.data?.digital.map(toItem) ?? []
  const physical = backend.data?.physical.map(toItem) ?? []
  return (
    <div className="space-y-10">
      <AlphaHero item={featured[0]} />
      {digital.length > 0 && <ItemGrid items={digital} title={t('digital')} />}
      {featured.length > 0 && <ItemGrid items={featured} title={t('featured')} />}
      <PhysicalEntry />
      {physical.length > 0 && <ItemGrid items={physical} title={t('physical')} />}
      {featured.length + digital.length + physical.length === 0 && <ItemGrid items={[]} />}
    </div>
  )
}

function PhysicalEntry() {
  const t = useTranslations('home')
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-6">
      <div>
        <p className="market-eyebrow">{t('physical')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('physicalHint')}</p>
      </div>
      <Link
        href="/explore?type=physical"
        className="font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t('browsePhysical')}
      </Link>
    </div>
  )
}
