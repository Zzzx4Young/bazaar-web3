'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApiResource } from '@/hooks/use-api-resource'
import { useOrderCommand } from '@/hooks/use-order-command'
import {
  listingCanBePurchased,
  publishedListingsResolvePath,
  resolvePublishedListings,
  type BackendListing,
  type ListingResolution
} from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { cartMinItems, cartMaxItems } from '@/lib/cart-policy'
import { useAuthStore } from '@/stores/use-auth-store'
import { useCartStore, type CartLine } from '@/stores/use-cart-store'

interface CheckoutResult {
  checkoutId: string
  orderIds: string[]
}

function lineState(line: CartLine, listing: BackendListing | undefined) {
  if (!listing || !listingCanBePurchased(listing)) return 'unavailable'
  if (
    listing.version !== line.version ||
    listing.title !== line.title ||
    listing.type !== line.type ||
    listing.price.amount !== line.amount ||
    listing.price.currency !== line.currency
  )
    return 'changed'
  return 'current'
}

export default function CartPage() {
  const t = useTranslations('cartPage')
  const account = useAuthStore((state) => state.view?.account)
  const cart = useCartStore()
  const [cartReady, setCartReady] = useState(false)
  useEffect(() => {
    void Promise.resolve(useCartStore.persist.rehydrate()).then(() => setCartReady(true))
  }, [])
  const items = cart.ownerId === account?.id ? cart.items : []

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        {t('simulated')}
      </p>
      {!account || account.role !== 'participant' ? (
        <p role="alert">{t('signIn')}</p>
      ) : !cartReady ? (
        <p role="status">{t('loading')}</p>
      ) : items.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <CartContents items={items} accountId={account.id} />
      )}
    </div>
  )
}

function CartContents({ items, accountId }: { items: CartLine[]; accountId: string }) {
  const locale = useLocale()
  const t = useTranslations('cartPage')
  const router = useRouter()
  const cart = useCartStore()
  const command = useOrderCommand()
  const [shipping, setShipping] = useState({ recipient: '', contact: '', address: '' })
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const ids = items.map((item) => item.listingId)
  const listings = useApiResource<ListingResolution>(publishedListingsResolvePath, { ids })
  const byId = new Map(listings.data?.items.map((listing) => [listing.id, listing]))
  const rows = items.map((line) => {
    const current = byId.get(line.listingId)
    return { line, current, state: lineState(line, current) }
  })
  const hasPhysical = items.some((item) => item.type === 'physical')
  const changed = rows.some(({ state }) => state !== 'current')
  const canCheckout =
    items.length >= cartMinItems &&
    items.length <= cartMaxItems &&
    !!listings.data &&
    !listings.loading &&
    !listings.refreshing &&
    !listings.error &&
    !changed &&
    !checking &&
    !command.busy &&
    !command.uncertain &&
    (!hasPhysical || Object.values(shipping).every((value) => value.trim()))

  const checkout = async () => {
    const cartMatches = () => {
      const current = useCartStore.getState()
      return (
        current.ownerId === accountId && JSON.stringify(current.items) === JSON.stringify(items)
      )
    }
    if (!canCheckout || useAuthStore.getState().view?.account.id !== accountId || !cartMatches())
      return
    setChecking(true)
    setCheckError(null)
    try {
      const fresh = await resolvePublishedListings(ids)
      if (useAuthStore.getState().view?.account.id !== accountId || !cartMatches()) return
      const freshById = new Map(fresh.items.map((listing) => [listing.id, listing]))
      if (items.some((line) => lineState(line, freshById.get(line.listingId)) !== 'current')) {
        setCheckError(t('listingChanged'))
        listings.reload()
        return
      }
      const result = await command.run<CheckoutResult>('/checkouts', {
        items: items.map((item) => ({
          listingId: item.listingId,
          version: item.version,
          ...(item.type === 'physical' ? { shipping } : {})
        }))
      })
      if (result) {
        cart.clear(accountId)
        router.push(`/me/checkouts/${result.checkoutId}`)
      }
    } catch (error) {
      setCheckError(t('refreshError', { error: apiErrorCopy(error, locale) }))
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      {listings.loading && <p role="status">{t('loading')}</p>}
      {listings.error && (
        <p role="alert">
          {t('refreshError', { error: listings.error })}
          <Button variant="link" onClick={listings.reload}>
            {t('refresh')}
          </Button>
        </p>
      )}
      {listings.data
        ? rows.map(({ line, current, state }) => (
            <article
              key={line.listingId}
              className="flex items-start justify-between gap-3 rounded-lg border p-4"
            >
              <div className="min-w-0">
                {current ? (
                  <>
                    <Link
                      href={`/listing/${line.listingId}`}
                      className="break-words font-medium hover:underline"
                    >
                      {current.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {current.price.amount} {current.price.currency}
                    </p>
                  </>
                ) : (
                  <p className="font-medium">{t('savedListing', { title: line.title })}</p>
                )}
                {state === 'changed' && (
                  <p role="alert" className="text-sm text-destructive">
                    {t('listingChanged')}
                  </p>
                )}
                {state === 'unavailable' && (
                  <p role="alert" className="text-sm text-destructive">
                    {t('listingUnavailable')}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => cart.remove(accountId, line.listingId)}
              >
                {t('remove')}
              </Button>
            </article>
          ))
        : items.map((line) => (
            <article
              key={line.listingId}
              className="flex items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div>
                <p className="font-medium">{t('savedListing', { title: line.title })}</p>
                <p className="text-sm text-muted-foreground">{t('unverifiedListing')}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => cart.remove(accountId, line.listingId)}
              >
                {t('remove')}
              </Button>
            </article>
          ))}
      {hasPhysical && (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="font-medium">{t('shipping')}</p>
          {(['recipient', 'contact', 'address'] as const).map((field) => (
            <Input
              key={field}
              aria-label={t(field)}
              value={shipping[field]}
              disabled={checking}
              onChange={(event) => setShipping({ ...shipping, [field]: event.target.value })}
            />
          ))}
        </div>
      )}
      {items.length < cartMinItems && (
        <p className="text-sm text-muted-foreground">{t('minimum', { min: cartMinItems })}</p>
      )}
      {checkError && (
        <p role="alert" className="text-destructive">
          {checkError}
        </p>
      )}
      {command.error && <p role="alert">{t('error', { error: command.error })}</p>}
      {command.uncertain && (
        <Button
          variant="outline"
          disabled={command.busy}
          onClick={async () => {
            const result = await command.retry<CheckoutResult>()
            if (result) {
              cart.clear(accountId)
              router.push(`/me/checkouts/${result.checkoutId}`)
            }
          }}
        >
          {t('retry')}
        </Button>
      )}
      <Button disabled={!canCheckout} onClick={() => void checkout()}>
        {t('checkout')}
      </Button>
    </>
  )
}
