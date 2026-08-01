// 排序下拉
'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SortBy } from '@/types'

const SORT_LABELS: Record<SortBy, string> = {
  newest: '最新发布',
  price_asc: '价格从低到高',
  price_desc: '价格从高到低',
  popular: '热度最高'
}

interface SortDropdownProps {
  value: SortBy
  onChange: (v: SortBy) => void
}

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  return (
    <Select value={value} onValueChange={v => onChange(v as SortBy)}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SORT_LABELS) as SortBy[]).map(k => (
          <SelectItem key={k} value={k}>
            {SORT_LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}