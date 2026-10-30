import { PublishForm } from '@/components/publish/publish-form'
import { getTranslations } from 'next-intl/server'

export default async function PublishPage() {
  const t = await getTranslations('demo')
  const tUi = await getTranslations('publishUi')
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{tUi('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('publishNotice')}</p>
      </div>
      <PublishForm />
    </div>
  )
}
