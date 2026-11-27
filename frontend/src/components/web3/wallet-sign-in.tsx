'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useRouter } from '@/i18n/routing'
import { useAuthStore } from '@/stores/use-auth-store'
import { backendPost, getTestnetConfig, BackendError, type AuthView } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { resolveSafeReturnTo } from '@/lib/safe-return-to'
import {
  injectedWallet,
  connectWallet,
  signWalletMessage,
  walletError
} from '@/lib/web3/wallet-client'
export function WalletSignIn({
  returnTo,
  onSuccess
}: {
  returnTo?: string
  onSuccess?: () => void
}) {
  const t = useTranslations('web3'),
    locale = useLocale(),
    router = useRouter()
  const [chainId, setChainId] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const active = useRef(false),
    inFlight = useRef(false)
  useEffect(() => {
    active.current = true
    const c = new AbortController()
    getTestnetConfig(c.signal).then(
      (v) => {
        if (active.current && v.enabled && 'chainId' in v && typeof v.chainId === 'number')
          setChainId(v.chainId)
      },
      () => {}
    )
    return () => {
      active.current = false
      c.abort()
    }
  }, [])
  const signIn = async () => {
    if (!chainId || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    const prior = useAuthStore.getState().view?.csrfToken
    const guard = () => {
      if (!active.current || useAuthStore.getState().view?.csrfToken !== prior)
        throw new Error('walletChanged')
    }
    try {
      const provider = injectedWallet(),
        address = await connectWallet(provider, chainId)
      guard()
      const challenge = await backendPost<{ id: string; message: string; expiresAt: string }>(
        '/auth/wallet/login/challenge',
        { address }
      )
      guard()
      const signature = await signWalletMessage(
        provider,
        chainId,
        address,
        challenge.message,
        guard
      )
      guard()
      const view = await backendPost<AuthView>('/auth/wallet/login/verify', {
        id: challenge.id,
        message: challenge.message,
        signature
      })
      guard()
      const destination = resolveSafeReturnTo(returnTo, '/me')
      useAuthStore.getState().acceptView(view)
      onSuccess?.()
      router.replace(destination)
    } catch (e) {
      if (active.current)
        setError(e instanceof BackendError ? apiErrorCopy(e, locale) : t(walletError(e)))
    } finally {
      inFlight.current = false
      if (active.current) setBusy(false)
    }
  }
  return chainId ? (
    <div className="space-y-2">
      <Button
        className="h-auto min-h-10 max-w-full whitespace-normal"
        variant="outline"
        disabled={busy}
        onClick={signIn}
      >
        {t('walletSignIn')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('walletLoginHint')}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  ) : null
}
