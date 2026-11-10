'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authenticatedPost } from '@/lib/authenticated-api'
import { getTestnetConfig } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { useAuthStore } from '@/stores/use-auth-store'
import { useApiResource } from '@/hooks/use-api-resource'
import {
  connectWallet,
  injectedWallet,
  signWalletData,
  walletError
} from '@/lib/web3/wallet-client'

export function WalletControls({ chainId }: { chainId: number }) {
  const t = useTranslations('web3'),
    locale = useLocale(),
    id = useId()
  const binding = useApiResource<{ address: string | null; bindingVersion: number }>(
    '/auth/wallet/current',
    {},
    true
  )
  const [address, setAddress] = useState(''),
    [purpose, setPurpose] = useState<'bind' | 'unbind' | 'payout'>('bind')
  const [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [emailId, setEmailId] = useState('')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('')
  const inFlight = useRef(false)
  const keys = useRef(new Map<string, string>())
  const post = <T,>(path: string, body: unknown) => {
    const identity = path + JSON.stringify(body)
    let key = keys.current.get(identity)
    if (!key) {
      key = crypto.randomUUID()
      keys.current.set(identity, key)
    }
    return authenticatedPost<T>(path, body, key)
  }
  useEffect(() => {
    let provider
    try {
      provider = injectedWallet()
    } catch {
      return
    }
    const reset = () => {
      setAddress('')
      setEmailId('')
      setResult('')
    }
    provider.on?.('accountsChanged', reset)
    provider.on?.('chainChanged', reset)
    return () => {
      provider.removeListener?.('accountsChanged', reset)
      provider.removeListener?.('chainChanged', reset)
    }
  }, [])
  const run = async (fn: (guard: () => void) => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    const token = useAuthStore.getState().view?.csrfToken
    const guard = () => {
      if (!token || useAuthStore.getState().view?.csrfToken !== token)
        throw new Error('walletChanged')
    }
    setBusy(true)
    setError('')
    setResult('')
    try {
      await fn(guard)
    } catch (e) {
      const k = walletError(e)
      setError(k === 'unknown' ? apiErrorCopy(e, locale) : t(k))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const wallet = purpose === 'bind' ? address : (binding.data?.address ?? '')
  const consume = async (proof: { id: string }, guard: () => void) => {
    guard()
    const challenge = await post<{ id: string; typedData: unknown }>('/auth/wallet/challenge', {
      proofId: proof.id,
      purpose,
      address: wallet
    })
    guard()
    const signature =
      purpose === 'unbind'
        ? undefined
        : await signWalletData(injectedWallet(), chainId, wallet, challenge.typedData, guard)
    guard()
    await authenticatedPost(
      purpose === 'payout' ? '/web3/payout/confirm' : '/auth/wallet/consume',
      { id: challenge.id, ...(signature ? { signature } : {}) }
    )
    guard()
    setPassword('')
    setCode('')
    setEmailId('')
    setResult(t('success'))
    keys.current.clear()
    binding.reload()
  }
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <h2 className="font-display text-2xl">{t('title')}</h2>
      <p className="text-sm">{t('testnet')}</p>
      <p className="text-sm text-muted-foreground">{t('connectHint')}</p>
      <Button
        disabled={busy}
        variant="outline"
        onClick={() =>
          run(async () => {
            setAddress(await connectWallet(injectedWallet(), chainId))
          })
        }
      >
        {t('connect')}
      </Button>
      <p className="break-all text-sm">
        {t('connected')}: {address || '—'}
      </p>
      <p className="break-all text-sm">
        {t('bound')}: {binding.data?.address ?? '—'}
      </p>
      {binding.error && <p role="alert">{binding.error}</p>}
      <label htmlFor={id + 'purpose'}>{t('purpose')}</label>
      <select
        id={id + 'purpose'}
        className="block rounded-md border bg-background p-2"
        value={purpose}
        onChange={(e) => {
          setPurpose(e.target.value as typeof purpose)
          setEmailId('')
          setResult('')
        }}
        disabled={busy}
      >
        <option value="bind">{t('bind')}</option>
        <option value="unbind">{t('unbind')}</option>
        <option value="payout">{t('payout')}</option>
      </select>
      <p className="text-sm text-muted-foreground">{t('authNotice')}</p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          keys.current.clear()
          setEmailId('')
          setCode('')
          setPassword('')
          setResult('')
          setError('')
        }}
      >
        {t('restart')}
      </Button>
      <fieldset disabled={busy || !wallet} className="space-y-3">
        <legend>{t('reauth')}</legend>
        <label htmlFor={id + 'password'}>{t('password')}</label>
        <Input
          id={id + 'password'}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          disabled={!password}
          onClick={() =>
            run(async (guard) =>
              consume(
                await post<{ id: string }>('/auth/wallet/reauth/password', {
                  password,
                  purpose,
                  address: wallet
                }),
                guard
              )
            )
          }
        >
          {t('passwordProof')}
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            run(async (guard) => {
              const r = await post<{ id: string }>('/auth/wallet/reauth/email/request', {
                purpose,
                address: wallet,
                locale
              })
              guard()
              setEmailId(r.id)
            })
          }
        >
          {t('emailProof')}
        </Button>
        {emailId && (
          <>
            <label htmlFor={id + 'code'}>{t('code')}</label>
            <Input
              id={id + 'code'}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              disabled={!/^\d{6}$/.test(code)}
              onClick={() =>
                run(async (guard) =>
                  consume(
                    await authenticatedPost<{ id: string }>('/auth/wallet/reauth/email/verify', {
                      id: emailId,
                      code
                    }),
                    guard
                  )
                )
              }
            >
              {t('verify')}
            </Button>
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && <p role="status">{result}</p>}
      <p className="text-sm text-muted-foreground">{t('walletBoundary')}</p>
    </section>
  )
}
export function TestnetWalletSettings() {
  const [chain, setChain] = useState<number | null>(null)
  useEffect(() => {
    const c = new AbortController()
    getTestnetConfig(c.signal).then(
      (v) => {
        if (v.enabled && 'chainId' in v && typeof v.chainId === 'number') setChain(v.chainId)
      },
      () => {}
    )
    return () => c.abort()
  }, [])
  return chain ? <WalletControls chainId={chain} /> : null
}
