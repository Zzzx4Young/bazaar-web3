// 排序下拉
'use client'

import { useTranslations } from 'next-intl'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SortBy } from '@/types'

interface SortDropdownProps {
  value: SortBy
  onChange: (v: SortBy) => void
}

const SORT_BY: SortBy[] = ['newest', 'price_asc', 'price_desc', 'popular']

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  const t = useTranslations('explore.sort')
  return (
    <Select value={value} onValueChange={v => onChange(v as SortBy)}>
      <SelectTrigger className="w-40" data-testid="sort-trigger">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_BY.map(k => (
          <SelectItem key={k} value={k} data-testid={`sort-option-${k}`}>
            {t(k)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}