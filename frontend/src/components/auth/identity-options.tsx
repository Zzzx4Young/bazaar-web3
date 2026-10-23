'use client'

import { useEffect, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { backendErrorMessage, backendPost, backendRequest } from '@/lib/backend-api'
import { useAuthStore } from '@/stores/use-auth-store'
import { resolveSafeReturnTo } from '@/lib/safe-return-to'
import type { AuthView } from '@/lib/backend-api'

interface Methods { password: boolean; google: boolean; emailCode: boolean }

export function IdentityOptions({ returnTo, googleReturnTo, onSuccess }: {
  returnTo?: string
  googleReturnTo?: string
  onSuccess?: () => void
}) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const formId = useId()
  const emailId = `${formId}-email`
  const codeId = `${formId}-code`
  const router = useRouter()
  const acceptView = useAuthStore(state => state.acceptView)
  const [methods, setMethods] = useState<Methods | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null)
  const [code, setCode] = useState('')

  useEffect(() => {
    let active = true
    backendRequest<Methods>('/auth/methods').then(value => {
      if (active) setMethods(value)
    }).catch(() => {
      if (active) setMethods({ password: true, google: false, emailCode: false })
    })
    return () => { active = false }
  }, [])

  return (
    <div className="space-y-3 border-t pt-4">
      {methods?.google && (
        <Button type="button" variant="outline" className="w-full" disabled={pending}
          onClick={async () => {
            setPending(true)
            setError(null)
            try {
              const result = await backendPost<{ authorizationUrl: string }>('/auth/google/start',
                { returnTo: googleReturnTo ?? returnTo ?? `/${locale}/me` })
              window.location.assign(result.authorizationUrl)
            } catch (cause) {
              setError(backendErrorMessage(cause))
              setPending(false)
            }
          }}>
          {t('googleSignIn')}
        </Button>
      )}
      {methods && !methods.google && (
        <p className="text-sm text-muted-foreground">{t('googleUnavailable')}</p>
      )}
      {methods?.emailCode ? <div className="space-y-3 border-t pt-4">
        <p className="text-sm font-medium">{t('emailCodeTitle')}</p>
        <form className="space-y-2" onSubmit={async event => {
          event.preventDefault()
          const normalized = email.trim().toLowerCase()
          if (normalized.length > 100 ||
            !/^[a-z0-9][a-z0-9._+-]{0,63}@gmail\.com$/.test(normalized) ||
            normalized.includes('..')) {
            setError(t('invalidGmail'))
            return
          }
          setPending(true)
          setError(null)
          try {
            await backendPost('/auth/email/request', { email: normalized, locale })
            setRequestedEmail(normalized)
            setCode('')
          } catch (cause) {
            setError(backendErrorMessage(cause))
          } finally { setPending(false) }
        }}>
          <Label htmlFor={emailId}>{t('emailAddress')}</Label>
          <Input id={emailId} type="email" autoComplete="email" value={email}
            onChange={event => {
              setEmail(event.target.value)
              setRequestedEmail(null)
              setCode('')
              setError(null)
            }} required disabled={pending} />
          <Button type="submit" variant="outline" disabled={pending}>{t('requestEmailCode')}</Button>
        </form>
        {requestedEmail && <form className="space-y-2" onSubmit={async event => {
          event.preventDefault()
          setPending(true)
          setError(null)
          try {
            const view = await backendPost<AuthView>('/auth/email/verify',
              { email: requestedEmail, code })
            acceptView(view)
            const destination = resolveSafeReturnTo(returnTo ?? `/${locale}/me`)
            onSuccess?.()
            router.replace(destination)
          } catch (cause) {
            setError(backendErrorMessage(cause))
          } finally { setPending(false) }
        }}>
          <p role="status" className="text-sm text-muted-foreground">{t('emailCodeSent')}</p>
          <Label htmlFor={codeId}>{t('verificationCode')}</Label>
          <Input id={codeId} value={code} onChange={event => setCode(event.target.value)}
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
            minLength={6} maxLength={6} required disabled={pending} />
          <Button type="submit" disabled={pending}>{t('verifyEmailCode')}</Button>
        </form>}
      </div> : methods && <p className="text-sm text-muted-foreground">
        {t('emailCodeUnavailable')}
      </p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
