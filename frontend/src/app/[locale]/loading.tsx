import { useTranslations } from 'next-intl'

export default function Loading() {
  const t = useTranslations('routeState')
  return (
    <div role="status" className="rounded-md border p-6 text-sm text-muted-foreground">
      {t('loading')}
    </div>
  )
}
