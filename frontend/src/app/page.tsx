// 首页：轮播 banner + 分类 tabs + 商品瀑布流
import { HeroBanner } from '@/components/home/hero-banner'
import { CategoryTabs } from '@/components/home/category-tabs'
import { ItemGrid } from '@/components/home/item-grid'
import { Button } from '@/components/ui/button'
import { banners, categories, items, sellers } from '@/lib/mock-data'

export default function HomePage() {
  const sellerMap = new Map(sellers.map(s => [s.id, s]))
  const featured = items.slice(0, 10)
  const digital = items.filter(i => i.category === 'digital').slice(0, 5)
  const physical = items.filter(i => i.category === 'physical').slice(0, 5)

  return (
    <div className="space-y-6">
      <HeroBanner banners={banners} />

      <CategoryTabs categories={categories} />

      <ItemGrid items={featured} sellers={sellerMap} title="🔥 精选推荐" />

      <ItemGrid items={digital} sellers={sellerMap} title="💎 数字资产" />

      <ItemGrid items={physical} sellers={sellerMap} title="📦 实物二手" />

      <div className="flex justify-center pt-4">
        <Button asChild variant="outline" size="lg">
          <a href="/explore">查看全部 →</a>
        </Button>
      </div>
    </div>
  )
}