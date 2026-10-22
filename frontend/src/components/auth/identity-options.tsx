'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { backendErrorMessage, backendPost, backendRequest } from '@/lib/backend-api'

interface Methods { password: boolean; google: boolean; emailCode: boolean }

export function IdentityOptions({ returnTo }: { returnTo?: string }) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const [methods, setMethods] = useState<Methods | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
                { returnTo: returnTo ?? `/${locale}/me` })
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
      <p className="text-sm text-muted-foreground">{t('emailCodeUnavailable')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
