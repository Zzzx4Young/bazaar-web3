'use client'

import { useTranslations } from 'next-intl'
import { ItemGrid } from './item-grid'
import { useApiResource } from '@/hooks/use-api-resource'
import { toItem, type BackendListing } from '@/lib/backend-api'
import { AlphaHero } from './alpha-hero'

interface HomeListings {
  featured: BackendListing[]
  digital: BackendListing[]
  physical: BackendListing[]
}

export function HomeItemGrids() {
  const backend = useApiResource<HomeListings>('/listings/home')
  const t = useTranslations('home')
  if (backend.loading) return <div className="space-y-8"><AlphaHero /><p role="status">{t('loading')}</p></div>
  if (backend.error)
    return (
      <div className="space-y-8"><AlphaHero /><p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">{t('loadError')}：{backend.error}</p></div>
    )
  const featured = backend.data?.featured.map(toItem) ?? []
  const digital = backend.data?.digital.map(toItem) ?? []
  const physical = backend.data?.physical.map(toItem) ?? []
  if (featured.length === 0) return <div className="space-y-8"><AlphaHero /><ItemGrid items={[]} /></div>
  return (
    <div className="space-y-10">
      <AlphaHero item={featured[0]} />
      <ItemGrid items={featured} title={t('featured')} />
      {digital.length > 0 && <ItemGrid items={digital} title={t('digital')} />}
      {physical.length > 0 && <ItemGrid items={physical} title={t('physical')} />}
    </div>
  )
}
