'use client'

import { Suspense, useEffect, useState } from 'react'
import { Link, usePathname } from '@/i18n/routing'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
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
import { IdentityOptions } from '@/components/auth/identity-options'
import { LoginMethodPicker, type LoginMethod } from '@/components/auth/login-method-picker'
import { locales } from '@/i18n/locales'
import { resolveSafeReturnTo } from '@/lib/safe-return-to'
import { apiErrorCopy } from '@/lib/api-error-copy'

const loginPaths = new Set(['/login', ...locales.map((locale) => `/${locale}/login`)])

function emailReturnTo(locale: string) {
  if (typeof window === 'undefined') return `/${locale}/me`
  const { pathname, search, hash } = window.location
  if (!loginPaths.has(pathname.replace(/\/$/, ''))) return `${pathname}${search}${hash}`

  const target = new URLSearchParams(search).get('returnTo')
  const safe = resolveSafeReturnTo(target ?? undefined)
  const destinationPath = safe.split(/[?#]/, 1)[0] ?? ''
  return loginPaths.has(destinationPath.replace(/\/$/, '')) ? '/me' : safe
}

function registrationHref(locale: string, fromDialog = true) {
  if (typeof window === 'undefined') return '/register'
  const { pathname, search } = window.location
  const onLoginPage = loginPaths.has(pathname.replace(/\/$/, ''))
  if (!fromDialog && !onLoginPage) return '/register'
  if (onLoginPage && !new URLSearchParams(search).has('returnTo')) return '/register'
  return `/register?returnTo=${encodeURIComponent(resolveSafeReturnTo(emailReturnTo(locale)))}`
}

function HeaderRegistrationLink({
  locale,
  pathname,
  label
}: {
  locale: string
  pathname: string
  label: string
}) {
  const search = useSearchParams().toString()
  const [href, setHref] = useState('/register')

  useEffect(() => {
    setHref(registrationHref(locale, false))
  }, [locale, pathname, search])

  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={href}>{label}</Link>
    </Button>
  )
}

export function TopNav() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<LoginMethod>('password')
  const [submitting, setSubmitting] = useState(false)
  const auth = useAuthStore()

  const links = [
    { href: '/', label: t('home') },
    { href: '/explore', label: t('explore') },
    { href: '/cart', label: t('cart') },
    { href: '/publish', label: t('publish') },
    { href: '/notifications', label: t('notifications') },
    { href: '/me', label: t('me') }
  ] as const

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-xl">
      <div className="container flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 py-3">
        <BrandLogo />
        <nav
          className="order-3 flex w-full min-w-0 items-center gap-5 overflow-x-auto pb-1 text-[13px] font-medium sm:order-none sm:w-auto sm:flex-1 sm:justify-center sm:pb-0"
          aria-label={t('home')}
        >
          {links.map((link) => {
            const active =
              pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? 'shrink-0 border-b-2 border-primary pb-1 font-semibold text-foreground'
                    : 'shrink-0 border-b-2 border-transparent pb-1 text-muted-foreground transition-colors hover:text-foreground'
                }
              >
                {link.label}
              </Link>
            )
          })}
          <FavoritesLink />
          {auth.view?.account.role === 'admin' && (
            <Link
              href="/admin/disputes"
              className="shrink-0 border-b-2 border-transparent pb-1 text-muted-foreground hover:text-foreground"
            >
              {t('adminDisputes')}
            </Link>
          )}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
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
            <>
              <Suspense
                fallback={
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/register">{t('register')}</Link>
                  </Button>
                }
              >
                <HeaderRegistrationLink locale={locale} pathname={pathname} label={t('register')} />
              </Suspense>
              <Button
                size="sm"
                onClick={() => {
                  setLoginName('')
                  setPassword('')
                  setMethod('password')
                  setOpen(true)
                }}
              >
                {t('login')}
              </Button>
            </>
          )}
        </div>
      </div>
      {auth.error && !open && (
        <p role="alert" className="container text-sm text-destructive">
          {t('authError')}：{apiErrorCopy(auth.error, locale)}
          {auth.errorRequestId && <span className="ml-2">{t('requestId', { id: auth.errorRequestId })}</span>}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('login')}</DialogTitle>
            <DialogDescription>{t('loginHint')}</DialogDescription>
          </DialogHeader>
          <LoginMethodPicker method={method} onChange={setMethod} />
          {method === 'password' && (
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
                  {t('authError')}：{apiErrorCopy(auth.error, locale)}
                  {auth.errorRequestId && (
                    <span className="ml-2">{t('requestId', { id: auth.errorRequestId })}</span>
                  )}
                </p>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting ? t('signingIn') : t('login')}
              </Button>
            </form>
          )}
          <IdentityOptions
            returnTo={emailReturnTo(locale)}
            googleReturnTo={
              typeof window === 'undefined' ? `/${locale}/me` : window.location.pathname
            }
            showEmail={method === 'email'}
            emailFirst={method === 'email'}
            onSuccess={() => setOpen(false)}
          />
          <p className="text-sm text-muted-foreground">
            {t('newAccount')}{' '}
            <Link
              href={registrationHref(locale)}
              className="font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              {t('register')}
            </Link>
          </p>
        </DialogContent>
      </Dialog>
    </header>
  )
}
