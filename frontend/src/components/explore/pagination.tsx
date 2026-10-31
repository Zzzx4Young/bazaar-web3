'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const t = useTranslations('explore.pagination')
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.max(page, 1), pageCount)
  return (
    <nav className="flex items-center justify-center gap-3" aria-label={t('label')}>
      <Button
        variant="outline"
        size="sm"
        aria-label={t('previous')}
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        {t('previous')}
      </Button>
      <span className="text-sm text-muted-foreground">
        {t('pageStatus', { page: currentPage, pageCount })}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label={t('next')}
        disabled={currentPage >= pageCount}
        onClick={() => onPageChange(currentPage + 1)}
      >
        {t('next')}
      </Button>
    </nav>
  )
}
