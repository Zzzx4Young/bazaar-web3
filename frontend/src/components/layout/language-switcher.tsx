'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/routing'
import { Languages } from 'lucide-react'

const LABELS: Record<string, string> = {
  'zh-CN': '中文',
  en: 'EN'
}

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const next = locale === 'zh-CN' ? 'en' : 'zh-CN'

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: next })}
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-foreground"
      aria-label="Switch language"
    >
      <Languages className="h-3.5 w-3.5" />
      {LABELS[locale] ?? locale}
    </button>
  )
}