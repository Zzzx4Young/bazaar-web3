import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { marketplaceCategories } from '@/lib/categories'

export function TrendingCategories() {
  const t = useTranslations('home.trending')

  return (
    <section aria-label={t('title')} className="space-y-3" data-testid="trending-categories">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
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
            className="group flex flex-col items-center justify-center gap-2 rounded-lg border bg-card p-4 transition-colors hover:border-primary hover:bg-primary/5"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110">
              <span className="text-xl font-bold" aria-hidden>
                {cat.label.slice(0, 1)}
              </span>
            </div>
            <div className="text-center text-sm font-medium text-foreground">{cat.label}</div>
          </Link>
        ))}
      </div>
    </section>
  )
}
