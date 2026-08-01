'use client'

import { Link, usePathname } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/layout/mode-toggle'

export function TopNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()

  const links = [
    { href: '/', label: t('home') },
    { href: '/explore', label: t('explore') },
    { href: '/publish', label: t('publish') },
    { href: '/favorites', label: t('favorites') },
    { href: '/me', label: t('me') }
  ] as const

  return (
    <header className="border-b">
      <div className="container flex h-14 items-center justify-between gap-4">
        <Link href="/" className="font-semibold">
          Bazaar Web3
        </Link>
        <nav className="flex gap-4 text-sm">
          {links.map(link => {
            const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <Button variant="outline" size="sm" disabled title="Auth coming soon">
            {t('login')}
          </Button>
        </div>
      </div>
    </header>
  )
}