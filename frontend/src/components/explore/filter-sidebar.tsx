// 列表筛选侧边栏
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useCurrencies } from '@/hooks/use-currencies'
import { useTranslations } from 'next-intl'
import type { Category, FilterState, ItemCategory, Currency, PrimaryCategory } from '@/types'

interface FilterSidebarProps {
  categories: Category[]
  filter: FilterState
  onKeyword: (v: string) => void
  onCategory: (v?: PrimaryCategory) => void
  onItemCategory: (v?: ItemCategory) => void
  onCurrency: (v?: Currency) => void
  onReset: () => void
}

export function FilterSidebar({
  categories,
  filter,
  onKeyword,
  onCategory,
  onItemCategory,
  onCurrency,
  onReset
}: FilterSidebarProps) {
  const t = useTranslations('filter')
  const tCategory = useTranslations('marketCategories')
  const NONE = 'all'
  const { currencies, loading: currenciesLoading, error: currenciesError, retry } = useCurrencies()
  return (
    <Card className="w-full lg:w-64">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* 关键词 */}
        <div className="space-y-1.5">
          <Label htmlFor="explore-keyword">{t('keyword')}</Label>
          <Input
            id="explore-keyword"
            placeholder={t('searchHint')}
            value={filter.keyword ?? ''}
            onChange={(e) => onKeyword(e.target.value)}
          />
        </div>

        {/* 一级分类 */}
        <div className="space-y-1.5">
          <Label>{t('category')}</Label>
          <Select
            value={filter.category ?? NONE}
            onValueChange={(v) => onCategory(v === NONE ? undefined : (v as PrimaryCategory))}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('all')}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {tCategory(c.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 实物 / 数字 */}
        <div className="space-y-1.5">
          <Label>{t('type')}</Label>
          <Select
            value={filter.itemCategory ?? NONE}
            onValueChange={(v) => onItemCategory(v === NONE ? undefined : (v as ItemCategory))}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('all')}</SelectItem>
              <SelectItem value="physical">{t('physical')}</SelectItem>
              <SelectItem value="digital">{t('digital')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 币种 */}
        <div className="space-y-1.5">
          <Label>{t('currency')}</Label>
          <Select
            value={filter.currency ?? NONE}
            onValueChange={(v) => onCurrency(v === NONE ? undefined : (v as Currency))}
            disabled={currenciesLoading || !!currenciesError}
          >
            <SelectTrigger>
              <SelectValue placeholder={currenciesLoading ? t('loadingCurrencies') : t('all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('all')}</SelectItem>
              {currencies.map(({ code }) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currenciesError && (
            <div role="alert" className="text-destructive">
              {t('currencyError', { error: currenciesError })}
              <Button type="button" variant="link" size="sm" onClick={retry}>
                {t('retry')}
              </Button>
            </div>
          )}
        </div>

        {/* 重置 */}
        <Button variant="outline" className="w-full" onClick={onReset}>
          {t('reset')}
        </Button>
      </CardContent>
    </Card>
  )
}
