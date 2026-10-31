import { BellOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslations } from 'next-intl'

export default function NotificationsPage() {
  const t = useTranslations('notificationsPage')
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <BellOff className="h-10 w-10 text-muted-foreground" aria-hidden />
          <h2 className="font-semibold">{t('unavailable')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t('body')}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
