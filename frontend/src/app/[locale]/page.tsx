import { setRequestLocale } from 'next-intl/server'
import { HeroBanner } from '@/components/home/hero-banner'
import { CategoryTabs } from '@/components/home/category-tabs'
import { HomeItemGrids } from '@/components/home/home-item-grids'
import { TrustStrip } from '@/components/home/trust-strip'
import { TrendingCategories } from '@/components/home/trending-categories'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import { banners, categories } from '@/lib/mock-data'

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('home')

  return (
    <div className="space-y-8">
      <HeroBanner banners={banners} />

      <CategoryTabs categories={categories} />

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
