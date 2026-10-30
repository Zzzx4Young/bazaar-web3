'use client'

import { useTranslations } from 'next-intl'

export default function Error({
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('routeState')
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-4 rounded-md border p-6">
      <h1 className="text-lg font-semibold">{t('errorTitle')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('errorBody')}
      </p>
      <button
        type="button"
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        onClick={reset}
      >
        {t('retry')}
      </button>
    </div>
  )
}
