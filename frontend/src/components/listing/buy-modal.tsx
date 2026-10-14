'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { useAuthStore } from '@/stores/use-auth-store'
import { useOrderCommand } from '@/hooks/use-order-command'
import {
  backendErrorMessage,
  fetchListingDetail,
  listingCanBePurchased,
  type BackendListing
} from '@/lib/backend-api'
import type { Item } from '@/types'

type CurrentListing = {
  key: string
  generation: number
  listing: BackendListing | null
  error: string | null
}

function listingChanged(item: Item, listing: BackendListing) {
  return (
    listing.version !== item.backendVersion ||
    listing.title !== item.title ||
    listing.type !== item.category ||
    listing.price.amount !== String(item.price.exactAmount ?? item.price.amount) ||
    listing.price.currency !== item.price.currency
  )
}

export function BuyModal({
  item,
  open,
  onOpenChange
}: {
  item: Item | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('buyModal')
  const router = useRouter()
  const auth = useAuthStore()
  const command = useOrderCommand()
  const [shipping, setShipping] = useState({ recipient: '', contact: '', address: '' })
  const [current, setCurrent] = useState<CurrentListing | null>(null)
  const [revision, setRevision] = useState(0)
  const [checkingGeneration, setCheckingGeneration] = useState<number | null>(null)
  const listingId = item?.id
  const accountId = auth.view?.account.id
  const key =
    open && item && auth.status === 'authenticated' && accountId ? `${accountId}:${item.id}` : null
  const sessionRef = useRef<{ key: string | null; generation: number }>({
    key: null,
    generation: 0
  })
  if (sessionRef.current.key !== key)
    sessionRef.current = { key, generation: sessionRef.current.generation + 1 }
  const generation = sessionRef.current.generation
  const checking = checkingGeneration === generation

  useEffect(() => {
    if (open) setShipping({ recipient: '', contact: '', address: '' })
  }, [open, item?.id])

  useEffect(() => {
    if (!key || !listingId) return
    let active = true
    const controller = new AbortController()
    setCurrent({ key, generation, listing: null, error: null })
    fetchListingDetail(listingId, controller.signal)
      .then((listing) => {
        if (active) setCurrent({ key, generation, listing, error: null })
      })
      .catch((error) => {
        if (active)
          setCurrent({ key, generation, listing: null, error: backendErrorMessage(error) })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [key, listingId, revision, generation])

  if (!item) return null
  const read = current?.key === key && current.generation === generation ? current : null
  const latest = read?.listing
  const unavailable = !!latest && !listingCanBePurchased(latest)
  const changed = !!latest && !unavailable && listingChanged(item, latest)
  const canConfirm =
    auth.status === 'authenticated' &&
    !!item.backendVersion &&
    !!latest &&
    !unavailable &&
    !changed &&
    !checking &&
    !command.busy &&
    !command.uncertain

  const submit = async () => {
    if (!canConfirm || !accountId || !key) return
    setCheckingGeneration(generation)
    try {
      const fresh = await fetchListingDetail(item.id)
      if (
        sessionRef.current.generation !== generation ||
        useAuthStore.getState().view?.account.id !== accountId
      )
        return
      setCurrent({ key, generation, listing: fresh, error: null })
      if (!listingCanBePurchased(fresh) || listingChanged(item, fresh)) return
      const result = await command.run('/orders', {
        listingId: item.id,
        version: item.backendVersion,
        ...(item.category === 'physical' ? { shipping } : {})
      })
      if (result && sessionRef.current.generation === generation) {
        onOpenChange(false)
        router.push('/me')
      }
    } catch (error) {
      if (sessionRef.current.generation === generation)
        setCurrent({ key, generation, listing: null, error: backendErrorMessage(error) })
    } finally {
      setCheckingGeneration((value) => (value === generation ? null : value))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {latest ? (
            <>
              <p className="font-medium">{latest.title}</p>
              <p className="text-sm text-muted-foreground">
                {latest.price.amount} {latest.price.currency}
              </p>
            </>
          ) : auth.status === 'authenticated' && !read?.error ? (
            <p role="status">{t('loading')}</p>
          ) : null}
          {unavailable && (
            <p role="alert" className="text-sm text-destructive">
              {t('unavailable')}
            </p>
          )}
          {changed && (
            <p role="alert" className="text-sm text-destructive">
              {t('changed')}
            </p>
          )}
          {(unavailable || changed) && (
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              {t('refreshPage')}
            </Button>
          )}
          {read?.error && (
            <div role="alert" className="text-sm text-destructive">
              {t('refreshError', { error: read.error })}
              <Button
                type="button"
                variant="link"
                onClick={() => setRevision((value) => value + 1)}
              >
                {t('retryCheck')}
              </Button>
            </div>
          )}
          {item.category === 'physical' && (
            <div className="space-y-2">
              <Label htmlFor="recipient">{t('recipient')}</Label>
              <Input
                id="recipient"
                value={shipping.recipient}
                disabled={checking}
                onChange={(e) => setShipping({ ...shipping, recipient: e.target.value })}
              />
              <Label htmlFor="contact">{t('contact')}</Label>
              <Input
                id="contact"
                value={shipping.contact}
                disabled={checking}
                onChange={(e) => setShipping({ ...shipping, contact: e.target.value })}
              />
              <Label htmlFor="address">{t('address')}</Label>
              <Input
                id="address"
                value={shipping.address}
                disabled={checking}
                onChange={(e) => setShipping({ ...shipping, address: e.target.value })}
              />
            </div>
          )}
          {auth.status !== 'authenticated' && (
            <p role="alert" className="text-sm text-destructive">
              {t('signIn')}
            </p>
          )}
          {command.error && (
            <p role="alert" className="text-sm text-destructive">
              {t('orderError', { error: command.error })}
            </p>
          )}
          {command.uncertain && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{t('uncertain')}</p>
              <Button
                variant="outline"
                disabled={command.busy}
                onClick={async () => {
                  const result = await command.retry()
                  if (result) {
                    onOpenChange(false)
                    router.push('/me')
                  }
                }}
              >
                {t('retryOrder')}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={!canConfirm} onClick={() => void submit()}>
            {checking || command.busy ? t('submitting') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
