'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { IdentityOptions } from '@/components/auth/identity-options'
import { resolveSafeReturnTo } from '@/lib/safe-return-to'

export default function RegisterPage() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const [returnTo, setReturnTo] = useState('/me')
  const [loginHref, setLoginHref] = useState('/login')

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('returnTo')
    const safe = resolveSafeReturnTo(value ?? undefined)
    setReturnTo(safe)
    if (value !== null) setLoginHref(`/login?returnTo=${encodeURIComponent(safe)}`)
  }, [])

  return (
    <section className="mx-auto w-full max-w-lg space-y-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div>
        <h1 className="market-heading text-3xl">{t('register')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('registerHint')}</p>
      </div>
      <IdentityOptions
        returnTo={returnTo}
        googleReturnTo={`/${locale}${returnTo}`}
        emailIntent="register"
      />
      <p className="text-sm text-muted-foreground">
        {t('existingAccount')}{' '}
        <Link href={loginHref} className="font-medium text-primary hover:underline">
          {t('login')}
        </Link>
      </p>
    </section>
  )
}
