'use client'

import { useTranslations } from 'next-intl'
import { ItemGrid } from './item-grid'
import { useBackendListings } from '@/hooks/use-backend-listings'

export function HomeItemGrids() {
  const backend = useBackendListings(new URLSearchParams({ sort: 'newest', limit: '20' }))
  const t = useTranslations('home')
  if (backend.loading) return <p role="status">{t('loading')}</p>
  if (backend.error)
    return (
      <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
        {t('loadError')}：{backend.error}
      </p>
    )
  const items = backend.items
  const digital = items.filter((item) => item.category === 'digital').slice(0, 5)
  const physical = items.filter((item) => item.category === 'physical').slice(0, 5)
  if (items.length === 0) return <ItemGrid items={[]} />
  return (
    <>
      <ItemGrid items={items.slice(0, 10)} title={t('featured')} />
      {digital.length > 0 && <ItemGrid items={digital} title={t('digital')} />}
      {physical.length > 0 && <ItemGrid items={physical} title={t('physical')} />}
    </>
  )
}
