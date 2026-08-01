import { getTranslations, setRequestLocale } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { TopNav } from '@/components/layout/top-nav'
import { LanguageSwitcher } from '@/components/layout/language-switcher'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import './globals.css'

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  return {
    title: t('title'),
    description: t('description'),
    metadataBase: new URL('http://localhost:3000'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      siteName: t('siteName'),
      type: 'website'
    }
  }
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!routing.locales.includes(locale as 'zh-CN' | 'en')) notFound()
  setRequestLocale(locale)

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <NextIntlClientProvider>
          <TopNav />
          <main className="container py-6">{children}</main>
          <footer className="mt-12 border-t py-6">
            <div className="container flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
              <span>
                Bazaar Web3 ·{' '}
                <FooterTagline />
              </span>
              <LanguageSwitcher />
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

async function FooterTagline() {
  const t = await getTranslations('footer')
  return <>{t('tagline')}</>
}