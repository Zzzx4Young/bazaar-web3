'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/routing'
import { useAuthStore } from '@/stores/use-auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IdentityOptions } from '@/components/auth/identity-options'
import { LoginMethodPicker, type LoginMethod } from '@/components/auth/login-method-picker'
import { resolveSafeReturnTo } from '@/lib/safe-return-to'
import { apiErrorCopy } from '@/lib/api-error-copy'

export default function LoginPage() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const router = useRouter()
  const auth = useAuthStore()
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<LoginMethod>('password')
  const [submitting, setSubmitting] = useState(false)
  const [returnTo, setReturnTo] = useState('/')
  const [registerHref, setRegisterHref] = useState('/register')
  const [redirectError, setRedirectError] = useState<string | null>(null)

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('returnTo')
    if (value?.startsWith('/')) setReturnTo(value)
    if (value !== null)
      setRegisterHref(`/register?returnTo=${encodeURIComponent(resolveSafeReturnTo(value))}`)
    setRedirectError(new URLSearchParams(window.location.search).get('authError'))
  }, [])

  return (
    <section className="mx-auto w-full max-w-lg space-y-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div>
        <h1 className="market-heading text-3xl">{t('login')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('loginHint')}</p>
      </div>
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
              router.replace(resolveSafeReturnTo(returnTo, '/'))
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
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? t('signingIn') : t('login')}
          </Button>
        </form>
      )}
      {redirectError && (
        <p role="alert" className="text-sm text-destructive">
          {redirectError === 'ACCOUNT_LINK_REQUIRED'
            ? t('accountLinkRequired')
            : t('googleSignInFailed')}
        </p>
      )}
      <IdentityOptions
        returnTo={returnTo === '/' ? `/${locale}/me` : returnTo}
        showEmail={method === 'email'}
        emailFirst={method === 'email'}
      />
      <p className="text-sm text-muted-foreground">
        {t('newAccount')}{' '}
        <Link href={registerHref} className="font-medium text-primary hover:underline">
          {t('register')}
        </Link>
      </p>
    </section>
  )
}
