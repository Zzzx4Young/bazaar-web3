import { PublishForm } from '@/components/publish/publish-form'
import { getTranslations } from 'next-intl/server'

export default async function PublishPage() {
  const t = await getTranslations('demo')
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">发布商品</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('publishNotice')}
        </p>
      </div>
      <PublishForm />
    </div>
  )
}
