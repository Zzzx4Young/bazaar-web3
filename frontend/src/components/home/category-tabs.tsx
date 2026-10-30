// 分类导航 tabs
'use client'

import { Link } from '@/i18n/routing'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Category } from '@/types'
import { useTranslations } from 'next-intl'

interface CategoryTabsProps {
  categories: Category[]
}

export function CategoryTabs({ categories }: CategoryTabsProps) {
  const t = useTranslations('filter')
  const tCategory = useTranslations('marketCategories')
  return (
    <div className="overflow-x-auto border-y border-border py-4">
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="inline-flex h-auto w-max gap-2 bg-transparent p-0">
          <TabsTrigger
            value="all"
            className="rounded-full border border-border bg-card px-5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            asChild
          >
            <Link href="/">{t('all')}</Link>
          </TabsTrigger>
          {categories.map((cat) => (
            <TabsTrigger
              key={cat.id}
              value={cat.id}
              className="rounded-full border border-border bg-card px-5 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              asChild
            >
              <Link href={`/explore?category=${cat.id}`}>{tCategory(cat.id)}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
