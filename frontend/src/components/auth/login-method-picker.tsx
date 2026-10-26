'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export type LoginMethod = 'password' | 'email'

export function LoginMethodPicker({ method, onChange }: {
  method: LoginMethod
  onChange: (method: LoginMethod) => void
}) {
  const t = useTranslations('nav')

  return (
    <div role="group" aria-label={t('loginMethod')} className="grid grid-cols-2 gap-2">
      <Button type="button" variant={method === 'password' ? 'secondary' : 'outline'}
        className="h-auto min-h-10 whitespace-normal text-center"
        aria-pressed={method === 'password'} onClick={() => onChange('password')}>
        {t('passwordLogin')}
      </Button>
      <Button type="button" variant={method === 'email' ? 'secondary' : 'outline'}
        className="h-auto min-h-10 whitespace-normal text-center"
        aria-pressed={method === 'email'} onClick={() => onChange('email')}>
        {t('emailCodeLogin')}
      </Button>
    </div>
  )
}
