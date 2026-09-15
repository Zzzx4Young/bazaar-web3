import { setRequestLocale } from 'next-intl/server'
import { AlphaHero } from '@/components/home/alpha-hero'
import { CategoryTabs } from '@/components/home/category-tabs'
import { HomeItemGrids } from '@/components/home/home-item-grids'
import { TrustStrip } from '@/components/home/trust-strip'
import { TrendingCategories } from '@/components/home/trending-categories'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import { marketplaceCategories } from '@/lib/categories'

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('home')

  return (
    <div className="space-y-8">
      <AlphaHero />

      <CategoryTabs categories={marketplaceCategories} />

      <TrustStrip />

      <TrendingCategories />

      <HomeItemGrids />

      <div className="flex justify-center pt-4">
        <Button asChild variant="outline" size="lg">
          <Link href="/explore">{t('viewAll')}</Link>
        </Button>
      </div>
    </div>
  )
}
