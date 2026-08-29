import { ShieldCheck, Percent, FlaskConical, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'

const ENTRIES = [
  { key: 'escrow', icon: ShieldCheck },
  { key: 'fee', icon: Percent },
  { key: 'testnet', icon: FlaskConical },
  { key: 'wallet', icon: Wallet }
] as const

export function TrustStrip() {
  const t = useTranslations('home.trust')

  return (
    <section
      aria-label={t('title')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      data-testid="trust-strip"
    >
      {ENTRIES.map(({ key, icon: Icon }) => (
        <div
          key={key}
          className="flex items-start gap-3 rounded-lg border bg-card p-4"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium leading-tight text-foreground">
              {t(`${key}.title`)}
            </div>
            <div className="mt-1 text-xs leading-snug text-muted-foreground">
              {t(`${key}.body`)}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}
