import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { marketplaceCategories } from '@/lib/categories'

export function TrendingCategories() {
  const t = useTranslations('home.trending')
  const tCategory = useTranslations('marketCategories')

  return (
    <section aria-label={t('title')} className="space-y-5" data-testid="trending-categories">
      <div className="flex items-baseline justify-between">
        <h2 className="market-heading flex items-center gap-2 text-2xl sm:text-3xl">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          {t('title')}
        </h2>
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <Link href="/explore">{t('viewAll')}</Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {marketplaceCategories.map((cat) => (
          <Link
            key={cat.id}
            href={`/explore?category=${cat.id}`}
            className="group flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary transition-transform group-hover:scale-105 motion-reduce:transform-none">
              <span className="font-display text-2xl font-semibold" aria-hidden>
                {tCategory(cat.id).slice(0, 1)}
              </span>
            </div>
            <div className="text-center text-sm font-medium text-foreground">
              {tCategory(cat.id)}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
