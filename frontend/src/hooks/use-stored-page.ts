'use client'

import { useEffect, useState } from 'react'
import { paginationPolicy } from '@/lib/pagination'

export function useStoredPage(key: string) {
  const [page, setPage] = useState<number>(paginationPolicy.firstPage)
  useEffect(() => {
    const saved = Number(sessionStorage.getItem(key))
    setPage(Number.isInteger(saved) && saved >= paginationPolicy.firstPage && saved <= paginationPolicy.maxPage
      ? saved : paginationPolicy.firstPage)
  }, [key])
  const changePage = (next: number) => {
    setPage(next)
    sessionStorage.setItem(key, String(next))
  }
  return [page, changePage] as const
}
