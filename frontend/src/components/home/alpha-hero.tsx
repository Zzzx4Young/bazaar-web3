import { ArrowRight, Database, ShieldCheck } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'

export async function AlphaHero() {
  const t = await getTranslations('home.hero')
  return (
    <section className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-indigo-950 via-violet-900 to-indigo-700 px-6 py-10 text-white sm:px-10">
      <div className="relative z-10 max-w-2xl">
        <p className="mb-3 text-sm font-medium text-indigo-200">{t('eyebrow')}</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-indigo-100 sm:text-base">{t('body')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild className="bg-white text-indigo-950 hover:bg-indigo-50">
            <Link href="/explore">
              {t('explore')} <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="border-white/40 bg-white/10 text-white hover:bg-white/20"
          >
            <Link href="/publish">{t('publish')}</Link>
          </Button>
        </div>
      </div>
      <Database className="absolute -right-6 -top-8 h-48 w-48 text-white/5" aria-hidden />
      <ShieldCheck className="absolute bottom-4 right-8 h-20 w-20 text-white/10" aria-hidden />
    </section>
  )
}
