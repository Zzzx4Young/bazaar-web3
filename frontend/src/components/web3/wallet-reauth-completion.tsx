'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/i18n/routing'
import { useAuthStore } from '@/stores/use-auth-store'
import { authenticatedPost } from '@/lib/authenticated-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { BackendError } from '@/lib/backend-api'
import {
  readWalletContinuation,
  walletContinuationKey,
  type WalletContinuation
} from '@/lib/web3/identity-client'
import { injectedWallet, signWalletData, walletError } from '@/lib/web3/wallet-client'
export function WalletReauthCompletion() {
  const t = useTranslations('web3'),
    locale = useLocale(),
    router = useRouter(),
    auth = useAuthStore()
  const [record, setRecord] = useState<WalletContinuation | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const active = useRef(true),
    inFlight = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    if (auth.status === 'loading') return
    setRecord(
      auth.view
        ? readWalletContinuation(
            sessionStorage.getItem(walletContinuationKey),
            auth.view.account.id
          )
        : null
    )
    setChecked(true)
  }, [auth.status, auth.view])
  const complete = async () => {
    if (!record || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    const token = useAuthStore.getState().view?.csrfToken
    const guard = () => {
      if (!active.current || !token || token !== useAuthStore.getState().view?.csrfToken)
        throw new Error('walletChanged')
    }
    try {
      guard()
      const challenge = await authenticatedPost<{ id: string; typedData: unknown }>(
        '/auth/wallet/challenge',
        { proofId: record.id, purpose: record.purpose, address: record.address },
        record.key
      )
      guard()
      const signature =
        record.purpose === 'unbind'
          ? undefined
          : await signWalletData(
              injectedWallet(),
              record.chainId,
              record.address,
              challenge.typedData,
              guard
            )
      guard()
      await authenticatedPost(
        record.purpose === 'payout' ? '/web3/payout/confirm' : '/auth/wallet/consume',
        { id: challenge.id, ...(signature ? { signature } : {}) }
      )
      guard()
      sessionStorage.removeItem(walletContinuationKey)
      router.replace('/me')
    } catch (e) {
      if (active.current)
        setError(e instanceof BackendError ? apiErrorCopy(e, locale) : t(walletError(e)))
    } finally {
      inFlight.current = false
      if (active.current) setBusy(false)
    }
  }
  return (
    <section className="mx-auto max-w-lg space-y-4 rounded-xl border p-6">
      <h1 className="font-display text-2xl">{t('googleComplete')}</h1>
      <p>{t('authNotice')}</p>
      {!checked ? (
        <p role="status">{t('loading')}</p>
      ) : !record ? (
        <p role="alert">{t('continuationInvalid')}</p>
      ) : (
        <>
          <p>{t(record.purpose)}</p>
          <p className="break-all font-mono text-xs">{record.address}</p>
          <Button
            className="h-auto min-h-10 max-w-full whitespace-normal"
            disabled={busy}
            onClick={complete}
          >
            {t('finishWalletOperation')}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
