'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

export function RecordPagination({ page, limit, total, hasMore, onPageChange }: {
  page: number
  limit: number
  total: number
  hasMore: boolean
  onPageChange: (page: number) => void
}) {
  const t = useTranslations('recordPagination')
  return (
    <nav aria-label={t('label')} className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm">
      <span>{t('status', { total, page, pages: Math.max(1, Math.ceil(total / limit)) })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>{t('previous')}</Button>
        <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => onPageChange(page + 1)}>{t('next')}</Button>
      </div>
    </nav>
  )
}
