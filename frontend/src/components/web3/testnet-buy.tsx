'use client'
import { useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/i18n/routing'
import { useAuthStore } from '@/stores/use-auth-store'
import { authenticatedPost } from '@/lib/authenticated-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import type { Item } from '@/types'
export function TestnetBuy({ item }: { item: Item }) {
  const t = useTranslations('web3'),
    locale = useLocale(),
    router = useRouter(),
    account = useAuthStore((s) => s.view?.account)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const key = useRef(crypto.randomUUID())
  if (!item.testnetPrice) return null
  const buy = async () => {
    if (busy || item.testnetPurchaseEligible !== true) return
    setBusy(true)
    setError('')
    const token = useAuthStore.getState().view?.csrfToken
    try {
      const r = await authenticatedPost<{ orderId: string }>(
        '/web3/orders',
        { listingId: item.id, version: item.backendVersion },
        key.current
      )
      if (token === useAuthStore.getState().view?.csrfToken) router.push(`/me/orders/${r.orderId}`)
    } catch (e) {
      setError(apiErrorCopy(e, locale))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-2 rounded-xl border bg-muted/30 p-4">
      <p className="font-semibold">{t('price', { amount: item.testnetPrice.amount })}</p>
      <p className="text-sm">{t('testnet')}</p>
      <p className="text-sm text-muted-foreground">{t('gas')}</p>
      <p className="text-sm text-muted-foreground">{t('downloadWarning')}</p>
      {item.testnetPurchaseEligible !== true && <p role="status">{t('payoutPaused')}</p>}
      <Button
        disabled={
          busy ||
          item.testnetPurchaseEligible !== true ||
          item.status !== 'active' ||
          item.purchaseEligible === false ||
          !account ||
          account.id === item.sellerId
        }
        onClick={buy}
      >
        {t('buy')}
      </Button>
      {error && (
        <>
          <p role="alert">{error}</p>
          <p>{t('protection')}</p>
        </>
      )}
    </section>
  )
}
