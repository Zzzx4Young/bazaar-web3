import { setRequestLocale } from 'next-intl/server'
import { HeroBanner } from '@/components/home/hero-banner'
import { CategoryTabs } from '@/components/home/category-tabs'
import { ItemGrid } from '@/components/home/item-grid'
import { TrustStrip } from '@/components/home/trust-strip'
import { TrendingCategories } from '@/components/home/trending-categories'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import { banners, categories, items, sellers } from '@/lib/mock-data'

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('home')

  const sellerMap = new Map(sellers.map(s => [s.id, s]))
  const featured = items.slice(0, 10)
  const digital = items.filter(i => i.category === 'digital').slice(0, 5)
  const physical = items.filter(i => i.category === 'physical').slice(0, 5)

  return (
    <div className="space-y-8">
      <HeroBanner banners={banners} />

      <CategoryTabs categories={categories} />

      <TrustStrip />

      <TrendingCategories />

      <ItemGrid items={featured} sellers={sellerMap} title={t('featured')} />

      <ItemGrid items={digital} sellers={sellerMap} title={t('digital')} />

      <ItemGrid items={physical} sellers={sellerMap} title={t('physical')} />

      <div className="flex justify-center pt-4">
        <Button asChild variant="outline" size="lg">
          <Link href="/explore">{t('viewAll')}</Link>
        </Button>
      </div>
    </div>
  )
}
