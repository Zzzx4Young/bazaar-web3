'use client'

import { Button } from '@/components/ui/button'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.max(page, 1), pageCount)
  return (
    <nav className="flex items-center justify-center gap-3" aria-label="商品分页">
      <Button
        variant="outline"
        size="sm"
        aria-label="上一页"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        上一页
      </Button>
      <span className="text-sm text-muted-foreground">
        第 {currentPage} / {pageCount} 页
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label="下一页"
        disabled={currentPage >= pageCount}
        onClick={() => onPageChange(currentPage + 1)}
      >
        下一页
      </Button>
    </nav>
  )
}
