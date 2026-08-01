// 分类导航 tabs
'use client'

import Link from 'next/link'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Category } from '@/types'

interface CategoryTabsProps {
  categories: Category[]
}

export function CategoryTabs({ categories }: CategoryTabsProps) {
  return (
    <div className="overflow-x-auto">
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="inline-flex h-auto w-max gap-1 bg-transparent p-0">
          <TabsTrigger
            value="all"
            className="rounded-full border bg-card px-4 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            asChild
          >
            <Link href="/">全部</Link>
          </TabsTrigger>
          {categories.map(cat => (
            <TabsTrigger
              key={cat.id}
              value={cat.id}
              className="rounded-full border bg-card px-4 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              asChild
            >
              <Link href={`/explore?category=${cat.id}`}>{cat.label}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}