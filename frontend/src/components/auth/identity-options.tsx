'use client'

import { useEffect, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BackendError, backendPost, backendRequest } from '@/lib/backend-api'
import { useAuthStore } from '@/stores/use-auth-store'
import { resolveSafeReturnTo } from '@/lib/safe-return-to'
import { apiErrorCopy } from '@/lib/api-error-copy'
import type { AuthView } from '@/lib/backend-api'

interface Methods { password: boolean; google: boolean; emailCode: boolean }

export function IdentityOptions({ returnTo, googleReturnTo, onSuccess,
  showEmail = true, emailFirst = false }: {
  returnTo?: string
  googleReturnTo?: string
  onSuccess?: () => void
  showEmail?: boolean
  emailFirst?: boolean
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
  const [requestError, setRequestError] = useState<string | null>(null)
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

  const googleOption = methods?.google ? (
    <Button type="button" variant="outline" className="w-full" disabled={pending}
      onClick={async () => {
        setPending(true)
        setError(null)
        try {
          const result = await backendPost<{ authorizationUrl: string }>('/auth/google/start',
            { returnTo: googleReturnTo ?? returnTo ?? `/${locale}/me` })
          window.location.assign(result.authorizationUrl)
        } catch (cause) {
          setError(apiErrorCopy(cause, locale))
          setPending(false)
        }
      }}>
      {t('googleSignIn')}
    </Button>
  ) : methods ? <p className="text-sm text-muted-foreground">{t('googleUnavailable')}</p> : null

  return (
    <div className="space-y-3 border-t pt-4">
      {!emailFirst && googleOption}
      {showEmail && methods?.emailCode ? <div
        className={emailFirst ? 'space-y-3' : 'space-y-3 border-t pt-4'}>
        <p className="text-sm font-medium">{t('emailCodeTitle')}</p>
        <form className="space-y-2" onSubmit={async event => {
          event.preventDefault()
          setError(null)
          const normalized = email.trim().toLowerCase()
          if (normalized.length > 100 ||
            !/^[a-z0-9][a-z0-9._+-]{0,63}@gmail\.com$/.test(normalized) ||
            normalized.includes('..')) {
            setRequestError(t('invalidGmail'))
            return
          }
          setPending(true)
          setRequestError(null)
          try {
            await backendPost('/auth/email/request', { email: normalized, locale })
            setRequestedEmail(normalized)
            setCode('')
          } catch (cause) {
            setRequestError(cause instanceof BackendError && cause.status === 429
              ? t('emailCodeRateLimited') : apiErrorCopy(cause, locale))
          } finally { setPending(false) }
        }}>
          <Label htmlFor={emailId}>{t('emailAddress')}</Label>
          <Input id={emailId} type="email" autoComplete="email" value={email}
            onChange={event => {
              setEmail(event.target.value)
              setRequestedEmail(null)
              setCode('')
              setError(null)
              setRequestError(null)
            }} required disabled={pending} />
          <Button type="submit" variant="outline" disabled={pending}>{t('requestEmailCode')}</Button>
          {requestError && <p role="alert" className="text-sm text-destructive">{requestError}</p>}
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
            setError(apiErrorCopy(cause, locale))
          } finally { setPending(false) }
        }}>
          <p role="status" className="text-sm text-muted-foreground">
            {process.env.NEXT_PUBLIC_EMAIL_CODE_DEV_INBOX === '1'
              ? t('emailCodeDevInbox') : t('emailCodeSent')}
          </p>
          <Label htmlFor={codeId}>{t('verificationCode')}</Label>
          <Input id={codeId} value={code} onChange={event => setCode(event.target.value)}
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
            minLength={6} maxLength={6} required disabled={pending} />
          <Button type="submit" disabled={pending}>{t('verifyEmailCode')}</Button>
        </form>}
      </div> : showEmail && methods && <p className="text-sm text-muted-foreground">
        {t('emailCodeUnavailable')}
      </p>}
      {emailFirst && googleOption}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
