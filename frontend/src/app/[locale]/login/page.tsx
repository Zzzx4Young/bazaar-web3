'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { useAuthStore } from '@/stores/use-auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const t = useTranslations('nav')
  const router = useRouter()
  const auth = useAuthStore()
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [returnTo, setReturnTo] = useState('/')

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('returnTo')
    if (value?.startsWith('/')) setReturnTo(value)
  }, [])

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('login')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('loginHint')}</p>
      </div>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setSubmitting(true)
          const ok = await auth.signIn(loginName, password)
          setSubmitting(false)
          if (ok) {
            setPassword('')
            router.replace(returnTo.replace(/^\/(zh-CN|en)/, '') || '/')
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
    </section>
  )
}
