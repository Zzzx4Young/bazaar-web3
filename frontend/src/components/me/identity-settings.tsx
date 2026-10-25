'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { backendRequest } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { useAuthStore } from '@/stores/use-auth-store'

interface IdentityStatus { google: boolean; email: boolean; hasPassword: boolean }
interface Methods { google: boolean; emailCode: boolean }

export function IdentitySettings() {
  const t = useTranslations('identity')
  const locale = useLocale()
  const account = useAuthStore(state => state.view?.account)
  const csrf = useAuthStore(state => state.view?.csrfToken)
  const [identities, setIdentities] = useState<IdentityStatus | null>(null)
  const [methods, setMethods] = useState<Methods | null>(null)
  const [password, setPassword] = useState('')
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
        <p className="text-sm text-muted-foreground">
          {identities?.email ? t('emailLinked') : methods?.emailCode
            ? t('emailAvailable') : t('emailUnavailable')}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
