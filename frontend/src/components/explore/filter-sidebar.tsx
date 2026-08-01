// 列表筛选侧边栏
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { Category, FilterState, ItemCategory, ItemCondition, Currency, PrimaryCategory } from '@/types'

interface FilterSidebarProps {
  categories: Category[]
  filter: FilterState
  onKeyword: (v: string) => void
  onCategory: (v?: PrimaryCategory) => void
  onItemCategory: (v?: ItemCategory) => void
  onCurrency: (v?: Currency) => void
  onCondition: (v?: ItemCondition) => void
  onReset: () => void
}

export function FilterSidebar({
  categories,
  filter,
  onKeyword,
  onCategory,
  onItemCategory,
  onCurrency,
  onCondition,
  onReset
}: FilterSidebarProps) {
  const NONE = 'all'
  return (
    <Card className="w-full lg:w-64">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">筛选</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* 关键词 */}
        <div className="space-y-1.5">
          <Label>关键词</Label>
          <Input
            placeholder="搜索商品..."
            value={filter.keyword ?? ''}
            onChange={e => onKeyword(e.target.value)}
          />
        </div>

        {/* 一级分类 */}
        <div className="space-y-1.5">
          <Label>分类</Label>
          <Select value={filter.category ?? NONE} onValueChange={v => onCategory(v === NONE ? undefined : (v as PrimaryCategory))}>
            <SelectTrigger>
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>全部</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 实物 / 数字 */}
        <div className="space-y-1.5">
          <Label>类型</Label>
          <Select value={filter.itemCategory ?? NONE} onValueChange={v => onItemCategory(v === NONE ? undefined : (v as ItemCategory))}>
            <SelectTrigger>
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>全部</SelectItem>
              <SelectItem value="physical">实物</SelectItem>
              <SelectItem value="digital">数字</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 币种 */}
        <div className="space-y-1.5">
          <Label>币种</Label>
          <Select value={filter.currency ?? NONE} onValueChange={v => onCurrency(v === NONE ? undefined : (v as Currency))}>
            <SelectTrigger>
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>全部</SelectItem>
              <SelectItem value="CNY">CNY</SelectItem>
              <SelectItem value="USDT">USDT</SelectItem>
              <SelectItem value="ETH">ETH</SelectItem>
              <SelectItem value="SOL">SOL</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 成色（仅实物） */}
        {filter.itemCategory === 'physical' && (
          <div className="space-y-1.5">
            <Label>成色</Label>
            <Select value={filter.condition ?? NONE} onValueChange={v => onCondition(v === NONE ? undefined : (v as ItemCondition))}>
              <SelectTrigger>
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>全部</SelectItem>
                <SelectItem value="new">全新</SelectItem>
                <SelectItem value="like_new">99新</SelectItem>
                <SelectItem value="good">95新</SelectItem>
                <SelectItem value="fair">9成新</SelectItem>
                <SelectItem value="poor">8成新</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 重置 */}
        <Button variant="outline" className="w-full" onClick={onReset}>
          重置筛选
        </Button>
      </CardContent>
    </Card>
  )
}