'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useOrderCommand } from '@/hooks/use-order-command'
import { useAuthStore } from '@/stores/use-auth-store'
import { useCartStore } from '@/stores/use-cart-store'

interface CheckoutResult { checkoutId: string; orderIds: string[] }

export default function CartPage() {
  const t = useTranslations('cartPage')
  const router = useRouter()
  const account = useAuthStore((state) => state.view?.account)
  const cart = useCartStore()
  const command = useOrderCommand()
  const [shipping, setShipping] = useState({ recipient: '', contact: '', address: '' })
  const [cartReady, setCartReady] = useState(false)
  useEffect(() => {
    void Promise.resolve(useCartStore.persist.rehydrate()).then(() => setCartReady(true))
  }, [])
  const items = cart.ownerId === account?.id ? cart.items : []
  const hasPhysical = items.some((item) => item.type === 'physical')
  const checkout = async () => {
    if (!account || items.length < 2) return
    const result = await command.run<CheckoutResult>('/checkouts', {
      items: items.map((item) => ({
        listingId: item.listingId,
        version: item.version,
        ...(item.type === 'physical' ? { shipping } : {})
      }))
    })
    if (result) {
      cart.clear(account.id)
      router.push(`/me/checkouts/${result.checkoutId}`)
    }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {!account || account.role !== 'participant' ? (
        <p role="alert">{t('signIn')}</p>
      ) : (
        <>
          {cartReady && !items.length && <p>{t('empty')}</p>}
          {items.map((item) => (
            <article key={item.listingId} className="flex items-start justify-between gap-3 rounded-lg border p-4">
              <div className="min-w-0">
                <Link href={`/listing/${item.listingId}`} className="break-words font-medium hover:underline">
                  {item.title}
                </Link>
                <p className="text-sm text-muted-foreground">{item.amount} {item.currency}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => cart.remove(account.id, item.listingId)}>
                {t('remove')}
              </Button>
            </article>
          ))}
          {hasPhysical && (
            <div className="space-y-2 rounded-lg border p-4">
              <p className="font-medium">{t('shipping')}</p>
              {(['recipient', 'contact', 'address'] as const).map((field) => (
                <Input key={field} aria-label={t(field)} value={shipping[field]}
                  onChange={(event) => setShipping({ ...shipping, [field]: event.target.value })} />
              ))}
            </div>
          )}
          {items.length === 1 && <p className="text-sm text-muted-foreground">{t('minimum')}</p>}
          {command.error && <p role="alert">{t('error', { error: command.error })}</p>}
          {command.uncertain && (
            <Button variant="outline" disabled={command.busy} onClick={async () => {
              const result = await command.retry<CheckoutResult>()
              if (result) {
                cart.clear(account.id)
                router.push(`/me/checkouts/${result.checkoutId}`)
              }
            }}>{t('retry')}</Button>
          )}
          <Button disabled={items.length < 2 || command.busy || command.uncertain ||
            (hasPhysical && Object.values(shipping).some((value) => !value.trim()))}
            onClick={() => void checkout()}>{t('checkout')}</Button>
        </>
      )}
    </div>
  )
}
