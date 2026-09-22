'use client'

import { useState } from 'react'
import { Link, usePathname } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ModeToggle } from '@/components/layout/mode-toggle'
import { FavoritesLink } from '@/components/layout/favorites-link'
import { BrandLogo } from '@/components/layout/brand-logo'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/use-auth-store'

export function TopNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const auth = useAuthStore()

  const links = [
    { href: '/', label: t('home') },
    { href: '/explore', label: t('explore') },
    { href: '/publish', label: t('publish') },
    { href: '/notifications', label: t('notifications') },
    { href: '/me', label: t('me') }
  ] as const

  return (
    <header className="border-b">
      <div className="container flex min-h-14 flex-wrap items-center justify-between gap-3 py-3">
        <BrandLogo />
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          {links.map((link) => {
            const active =
              pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }
              >
                {link.label}
              </Link>
            )
          })}
          <FavoritesLink />
          {auth.view?.account.role === 'admin' && (
            <Link href="/admin/disputes" className="text-muted-foreground hover:text-foreground">
              {t('adminDisputes')}
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          {auth.status === 'authenticated' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true)
                await auth.signOut()
                setSubmitting(false)
              }}
            >
              {auth.view?.account.displayName} · {t('logout')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {t('login')}
            </Button>
          )}
        </div>
      </div>
      {auth.error && !open && (
        <p role="alert" className="container text-sm text-destructive">
          {t('authError')}：{auth.error}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('login')}</DialogTitle>
            <DialogDescription>{t('loginHint')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault()
              setSubmitting(true)
              const ok = await auth.signIn(loginName, password)
              setSubmitting(false)
              if (ok) {
                setPassword('')
                setOpen(false)
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="login-name">{t('loginName')}</Label>
              <Input
                id="login-name"
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">{t('password')}</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {auth.error && (
              <p role="alert" className="text-sm text-destructive">
                {t('authError')}：{auth.error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? t('signingIn') : t('login')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  )
}
