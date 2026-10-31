import { getTranslations, setRequestLocale } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { TopNav } from '@/components/layout/top-nav'
import { LanguageSwitcher } from '@/components/layout/language-switcher'
import { ThemeProvider } from '@/components/layout/theme-provider'
import { ThemeFaviconSync } from '@/components/layout/theme-favicon-sync'
import { AuthSession } from '@/components/auth/auth-session'
import { Toaster } from '@/components/ui/toaster'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import './globals.css'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
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
  const tDemo = await getTranslations('demo')
  const tNav = await getTranslations('nav')

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var theme=JSON.parse(localStorage.getItem('c2c:theme')||'null');if(theme!=='light'&&theme!=='dark')theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.add(theme)}catch(e){document.documentElement.classList.add('light')}`
          }}
        />
      </head>
      <body className="flex min-h-screen flex-col bg-background font-sans antialiased">
        <NextIntlClientProvider>
          <ThemeProvider>
            <AuthSession />
            <ThemeFaviconSync />
            <Toaster />
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2"
            >
              {tNav('skipContent')}
            </a>
            <TopNav />
            <div className="border-b border-border/70 bg-secondary/50 px-4 py-2 text-center text-xs tracking-wide text-muted-foreground">
              {tDemo('notice')}
            </div>
            <main id="main-content" className="container w-full flex-1 py-7 sm:py-10">
              {children}
            </main>
            <footer className="mt-16 border-t border-border/80 bg-card/70 py-8">
              <div className="container flex flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row">
                <span className="font-semibold tracking-[0.12em] text-foreground">
                  BAZAAR <span className="text-primary">✦</span>{' '}
                  <span className="ml-2 font-normal tracking-normal text-muted-foreground">
                    <FooterTagline />
                  </span>
                </span>
                <LanguageSwitcher />
              </div>
            </footer>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

async function FooterTagline() {
  const t = await getTranslations('footer')
  return <>{t('tagline')}</>
}
