'use client'

import { useTranslations } from 'next-intl'
import { ItemGrid } from './item-grid'
import { sellers } from '@/lib/mock-data'
import { useItemStore } from '@/stores/use-item-store'

const sellerMap = new Map(sellers.map(seller => [seller.id, seller]))

export function HomeItemGrids() {
  const { items } = useItemStore()
  const t = useTranslations('home')
  return <>
    <ItemGrid items={items.slice(0, 10)} sellers={sellerMap} title={t('featured')} />
    <ItemGrid items={items.filter(item => item.category === 'digital').slice(0, 5)} sellers={sellerMap} title={t('digital')} />
    <ItemGrid items={items.filter(item => item.category === 'physical').slice(0, 5)} sellers={sellerMap} title={t('physical')} />
  </>
}
