import { PublishForm } from '@/components/publish/publish-form'
import { useTranslations } from 'next-intl'

export default function CreateListingPage() {
  const t = useTranslations('createListing')
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('hint')}
        </p>
      </div>
      <PublishForm />
    </div>
  )
}
