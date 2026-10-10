'use client'

import { useTranslations } from 'next-intl'
import { ItemGrid } from './item-grid'
import { useApiResource } from '@/hooks/use-api-resource'
import { toItem, type BackendListing } from '@/lib/backend-api'

interface HomeListings {
  featured: BackendListing[]
  digital: BackendListing[]
  physical: BackendListing[]
}

export function HomeItemGrids() {
  const backend = useApiResource<HomeListings>('/listings/home')
  const t = useTranslations('home')
  if (backend.loading) return <p role="status">{t('loading')}</p>
  if (backend.error)
    return (
      <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
        {t('loadError')}：{backend.error}
      </p>
    )
  const featured = backend.data?.featured.map(toItem) ?? []
  const digital = backend.data?.digital.map(toItem) ?? []
  const physical = backend.data?.physical.map(toItem) ?? []
  if (featured.length === 0) return <ItemGrid items={[]} />
  return (
    <>
      <ItemGrid items={featured} title={t('featured')} />
      {digital.length > 0 && <ItemGrid items={digital} title={t('digital')} />}
      {physical.length > 0 && <ItemGrid items={physical} title={t('physical')} />}
    </>
  )
}
