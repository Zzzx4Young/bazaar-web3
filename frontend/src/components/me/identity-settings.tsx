'use client'

import { useEffect, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { backendRequest, type AuthView } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { normalizeGmailInput } from '@/lib/gmail'
import { useAuthStore } from '@/stores/use-auth-store'

interface IdentityStatus { google: boolean; email: boolean; hasPassword: boolean }
interface Methods { google: boolean; emailCode: boolean; emailBindPasswordRequired?: boolean }

export function IdentitySettings() {
  const t = useTranslations('identity')
  const locale = useLocale()
  const account = useAuthStore(state => state.view?.account)
  const csrf = useAuthStore(state => state.view?.csrfToken)
  const acceptView = useAuthStore(state => state.acceptView)
  const formId = useId()
  const [identities, setIdentities] = useState<IdentityStatus | null>(null)
  const [methods, setMethods] = useState<Methods | null>(null)
  const [password, setPassword] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [email, setEmail] = useState('')
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!account || account.role !== 'participant') return
    let active = true
    Promise.all([
      backendRequest<IdentityStatus>('/auth/identities'),
      backendRequest<Methods>('/auth/methods')
    ]).then(([status, available]) => {
      if (active) { setIdentities(status); setMethods(available) }
    }).catch(cause => { if (active) setError(apiErrorCopy(cause, locale)) })
    return () => { active = false }
  }, [account, locale])

  if (!account || account.role !== 'participant') return null
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        {identities?.google ? <p>{t('googleLinked')}</p> : methods?.google ? (
          <div className="space-y-3">
            {identities?.hasPassword && <div className="space-y-2">
              <Label htmlFor="identity-password">{t('confirmPassword')}</Label>
              <Input id="identity-password" type="password" autoComplete="current-password"
                value={password} onChange={event => setPassword(event.target.value)} />
            </div>}
            <Button type="button" disabled={pending || !csrf || (identities?.hasPassword && !password)}
              onClick={async () => {
                setPending(true)
                setError(null)
                try {
                  const result = await backendRequest<{ authorizationUrl: string }>(
                    '/auth/google/bind/start', {
                      method: 'POST', headers: { 'X-CSRF-Token': csrf! },
                      body: JSON.stringify({ password: password || undefined,
                        returnTo: window.location.pathname })
                    })
                  window.location.assign(result.authorizationUrl)
                } catch (cause) {
                  setError(apiErrorCopy(cause, locale))
                  setPending(false)
                }
              }}>{t('linkGoogle')}</Button>
          </div>
        ) : <p className="text-sm text-muted-foreground">{t('googleUnavailable')}</p>}
        {identities?.email ? <p className="text-sm text-muted-foreground">{t('emailLinked')}</p>
          : methods?.emailCode ? <div className="space-y-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">{t('emailAvailable')}</p>
            <form className="space-y-2" onSubmit={async event => {
              event.preventDefault()
              setError(null)
              const normalized = normalizeGmailInput(email)
              if (!normalized) {
                setError(t('invalidGmail'))
                return
              }
              setPending(true)
              try {
                await backendRequest('/auth/email/bind/request', {
                  method: 'POST', headers: { 'X-CSRF-Token': csrf! },
                  body: JSON.stringify({ email: normalized, locale,
                    password: emailPassword || undefined })
                })
                setRequestedEmail(normalized)
                setCode('')
              } catch (cause) { setError(apiErrorCopy(cause, locale)) }
              finally { setPending(false) }
            }}>
              <Label htmlFor={`${formId}-email`}>{t('emailAddress')}</Label>
              <Input id={`${formId}-email`} type="email" autoComplete="email" value={email}
                onChange={event => { setEmail(event.target.value); setRequestedEmail(null);
                  setCode(''); setError(null) }} required disabled={pending} />
              {methods.emailBindPasswordRequired && identities?.hasPassword && <>
                <Label htmlFor={`${formId}-password`}>{t('confirmPassword')}</Label>
                <Input id={`${formId}-password`} type="password" autoComplete="current-password"
                  value={emailPassword} onChange={event => setEmailPassword(event.target.value)}
                  required disabled={pending} />
              </>}
              <Button type="submit" variant="outline" disabled={pending || !csrf ||
                (methods.emailBindPasswordRequired && identities?.hasPassword && !emailPassword)}>
                {t('requestEmailCode')}
              </Button>
            </form>
            {requestedEmail && <form className="space-y-2" onSubmit={async event => {
              event.preventDefault()
              setPending(true)
              setError(null)
              try {
                const view = await backendRequest<AuthView>('/auth/email/bind/verify', {
                  method: 'POST', headers: { 'X-CSRF-Token': csrf! },
                  body: JSON.stringify({ email: requestedEmail, code })
                })
                acceptView(view)
                setIdentities(current => current ? { ...current, email: true } : current)
                setCode('')
                setEmailPassword('')
              } catch (cause) { setError(apiErrorCopy(cause, locale)) }
              finally { setPending(false) }
            }}>
              <p role="status" className="text-sm text-muted-foreground">
                {process.env.NEXT_PUBLIC_EMAIL_CODE_DEV_INBOX === '1'
                  ? t('emailCodeDevInbox') : t('emailCodeSent')}
              </p>
              <Label htmlFor={`${formId}-code`}>{t('verificationCode')}</Label>
              <Input id={`${formId}-code`} value={code}
                onChange={event => setCode(event.target.value)} inputMode="numeric"
                autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6}
                required disabled={pending} />
              <Button type="submit" disabled={pending}>{t('verifyEmailCode')}</Button>
            </form>}
          </div> : <p className="text-sm text-muted-foreground">{t('emailUnavailable')}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
