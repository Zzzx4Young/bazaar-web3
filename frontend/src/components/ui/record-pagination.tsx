'use client'

import { Button } from '@/components/ui/button'

export function RecordPagination({ page, limit, total, hasMore, onPageChange }: {
  page: number
  limit: number
  total: number
  hasMore: boolean
  onPageChange: (page: number) => void
}) {
  return (
    <nav aria-label="记录分页" className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm">
      <span>共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / limit))} 页</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</Button>
        <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => onPageChange(page + 1)}>下一页</Button>
      </div>
    </nav>
  )
}
