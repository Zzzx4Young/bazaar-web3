'use client'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useVisiblePolling } from '@/hooks/use-visible-polling'
import { orderRefreshIntervalMs } from '@/lib/refresh-policy'
import { useApiResource } from '@/hooks/use-api-resource'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'
import { BackendError } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import {
  buildDirectCall,
  buildDeliveryCall,
  type OrderAddresses,
  type DeliveryView,
  type DirectAction
} from '@/lib/web3/escrow-client'
import {
  injectedWallet,
  connectWallet,
  sendWalletTransaction,
  signWalletData,
  walletError
} from '@/lib/web3/wallet-client'
import { IntentPanel } from './intent-panel'
import { EscrowStatus } from './escrow-status'
import { DirectActions } from './direct-actions'
import { PrivateFileUpload } from './private-file-upload'
import { EvidencePanel } from './evidence-panel'
interface TermsView {
  payment: {
    chainId: number
    escrow: string
    orderId: string
    buyer: string
    seller: string
    refundAddress: string
  }
  intentId: string | null
}
export function EscrowOrder({
  orderId,
  buyerId,
  sellerId
}: {
  orderId: string
  buyerId: string
  sellerId: string
}) {
  const t = useTranslations('web3')
  const terms = useApiResource<TermsView>(`/web3/orders/${orderId}/terms`, {}, true)
  if (!terms.data?.payment)
    return (
      <section className="space-y-3">
        <p role={terms.error ? 'alert' : 'status'}>{terms.error ?? t('loading')}</p>
        <p>{t('protection')}</p>
        <Button onClick={terms.reload}>{t('refresh')}</Button>
      </section>
    )
  const p = terms.data.payment
  return (
    <EscrowOrderContent
      key={orderId}
      orderId={orderId}
      buyerId={buyerId}
      sellerId={sellerId}
      order={{ ...p, chainOrderId: p.orderId }}
      intentId={terms.data.intentId}
      reloadTerms={terms.reload}
    />
  )
}
function EscrowOrderContent({
  orderId,
  buyerId,
  sellerId,
  order,
  intentId,
  reloadTerms
}: {
  orderId: string
  buyerId: string
  sellerId: string
  order: OrderAddresses
  intentId: string | null
  reloadTerms: () => void
}) {
  const t = useTranslations('web3'),
    locale = useLocale(),
    account = useAuthStore((s) => s.view?.account.id)
  const delivery = useApiResource<DeliveryView>(`/web3/orders/${orderId}/delivery/read`, {}, true)
  const [address, setAddress] = useState(''),
    [version, setVersion] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [waiting, setWaiting] = useState(false),
    [accept, setAccept] = useState(false),
    [hash, setHash] = useState('')
  useVisiblePolling(delivery.poll, !!account, orderRefreshIntervalMs)
  const [targetState, setTargetState] = useState('')
  const [grant, setGrant] = useState<{ url: string; expiresAt: string } | null>(null)
  const inFlight = useRef(false)
  const keys = useRef(new Map<string, string>())
  const key = (op: string) => {
    let v = keys.current.get(op)
    if (!v) {
      v = crypto.randomUUID()
      keys.current.set(op, v)
    }
    return v
  }
  useEffect(() => {
    if (targetState && delivery.data?.state === targetState) setWaiting(false)
  }, [targetState, delivery.data?.state])
  const reload = () => {
    delivery.reload()
    reloadTerms()
  }
  useEffect(() => {
    let p
    try {
      p = injectedWallet()
    } catch {
      return
    }
    const reset = () => setAddress('')
    p.on?.('accountsChanged', reset)
    p.on?.('chainChanged', reset)
    return () => {
      p.removeListener?.('accountsChanged', reset)
      p.removeListener?.('chainChanged', reset)
    }
  }, [])
  useEffect(() => {
    setGrant(null)
  }, [account, delivery.data?.state])
  const run = async (fn: (guard: () => void) => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    const token = useAuthStore.getState().view?.csrfToken
    const guard = () => {
      if (!token || token !== useAuthStore.getState().view?.csrfToken)
        throw new Error('walletChanged')
    }
    setBusy(true)
    setError('')
    setGrant(null)
    try {
      await fn(guard)
    } catch (e) {
      const k = walletError(e)
      if (k === 'unknown' && !(e instanceof BackendError)) setWaiting(true)
      setError(e instanceof BackendError ? apiErrorCopy(e, locale) : t(k))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const report = async (h: string, guard: () => void, target: string) => {
    setTargetState(target)
    guard()
    setHash(h)
    setWaiting(true)
    await authenticatedPost(
      `/web3/orders/${orderId}/transaction-attempts`,
      { txHash: h },
      key('tx:' + h)
    )
    guard()
    reload()
  }
  const chainAction = async (action: DirectAction, guard: () => void) => {
    const from =
      action === 'accept' || action === 'openDispute'
        ? order.buyer
        : await connectWallet(injectedWallet(), order.chainId)
    guard()
    const call = buildDirectCall(action, order.escrow, order.chainOrderId)
    await report(
      await sendWalletTransaction(injectedWallet(), order.chainId, from, call.to, call.data, guard),
      guard,
      action === 'openDispute' ? 'Disputed' : action.startsWith('refund') ? 'Refunded' : 'Released'
    )
  }
  const publish = async (guard: () => void) => {
    const challenge = await authenticatedPost<{ id: string; typedData: unknown }>(
      `/web3/orders/${orderId}/delivery/supplements/challenge`,
      { versionId: version },
      key('publish:' + version)
    )
    guard()
    const signature = await signWalletData(
      injectedWallet(),
      order.chainId,
      order.seller,
      challenge.typedData,
      guard
    )
    guard()
    await authenticatedPost(`/web3/orders/${orderId}/delivery/supplements/publish`, {
      versionId: version,
      authorizationId: challenge.id,
      signature
    })
    guard()
    reload()
  }
  const register = async (guard: () => void) => {
    const permit = await authenticatedPost<{ permit: unknown; signature: string }>(
      `/web3/orders/${orderId}/delivery/permit`,
      { versionId: version },
      key('register:' + version)
    )
    guard()
    const call = buildDeliveryCall(order.escrow, permit.permit, permit.signature)
    await report(
      await sendWalletTransaction(
        injectedWallet(),
        order.chainId,
        order.seller,
        call.to,
        call.data,
        guard
      ),
      guard,
      'Delivered'
    )
  }
  const download = async (versionId: string, guard: () => void) => {
    const r = await authenticatedPost<{ url: string; expiresAt: string }>(
      `/web3/orders/${orderId}/delivery/download`,
      { versionId }
    )
    guard()
    setGrant(r)
  }
  const state = delivery.data
  const now = Math.floor(Date.now() / 1000)
  const timeoutAllowed = (a: DirectAction) =>
    a === 'refundUndelivered'
      ? state?.state === 'Funded' && now >= state.deliveryDeadline
      : a === 'settleExpired'
        ? state?.state === 'Delivered' &&
          state.acceptanceDeadline != null &&
          now >= state.acceptanceDeadline
        : state?.state === 'Disputed' &&
          state.disputeDeadline != null &&
          now >= state.disputeDeadline
  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl">{t('title')}</h1>
      <p className="rounded-xl border bg-muted/30 p-3 font-medium">{t('testnet')}</p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          run(async () => setAddress(await connectWallet(injectedWallet(), order.chainId)))
        }
      >
        {t('connect')}
      </Button>
      <p className="break-all text-sm">
        {t('connected')}: {address || '—'}
      </p>
      <p>{t('walletBoundary')}</p>
      <DirectActions
        order={order}
        snapshot={
          state
            ? {
                state: state.state,
                deliveryDeadline: state.deliveryDeadline,
                acceptanceDeadline: state.acceptanceDeadline,
                disputeDeadline: state.disputeDeadline,
                finalizedHeight: state.finalizedHeight,
                finalizedBlockHash: state.finalizedBlockHash
              }
            : undefined
        }
      />
      {account === buyerId && intentId && (
        <IntentPanel key={intentId} orderId={orderId} intentId={intentId} onRefresh={reload} />
      )}
      <EscrowStatus
        state={state?.state ?? t('pending')}
        deadline={state?.disputeDeadline ?? state?.acceptanceDeadline ?? state?.deliveryDeadline}
        waiting={waiting}
      />
      {hash && <p className="break-all font-mono text-xs">{hash}</p>}
      {delivery.error && <p role="alert">{delivery.error}</p>}
      <Button variant="outline" onClick={reload}>
        {t('refresh')}
      </Button>
      <div className="space-y-3 rounded-xl border p-4">
        {account === buyerId && (
          <>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={accept}
                onChange={(e) => setAccept(e.target.checked)}
              />
              {t('acceptWarning')}
            </label>
            <Button
              disabled={busy || !accept || state?.state !== 'Delivered'}
              onClick={() => run((g) => chainAction('accept', g))}
            >
              {t('accept')}
            </Button>
            <Button
              disabled={busy || (!!state && state.state !== 'Delivered')}
              variant="outline"
              onClick={() => run((g) => chainAction('openDispute', g))}
            >
              {t('openDispute')}
            </Button>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {(['refundUndelivered', 'settleExpired', 'refundDisputeTimeout'] as const).map((a) => (
            <Button
              key={a}
              variant="outline"
              disabled={busy || !timeoutAllowed(a)}
              onClick={() => run((g) => chainAction(a, g))}
            >
              {t(a)}
            </Button>
          ))}
        </div>
      </div>
      {account === sellerId && (
        <section className="space-y-3">
          <PrivateFileUpload orderId={orderId} purpose="delivery" onReady={setVersion} />
          {version && (
            <p className="break-all text-xs">
              {t('version')}: {version}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('registerHint')}</p>
          <Button
            disabled={busy || !version || state?.state !== 'Funded'}
            onClick={() => run(register)}
          >
            {t('register')}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !version || !state?.firstVersionId || state.state === 'Refunded'}
            onClick={() => run(publish)}
          >
            {t('publish')}
          </Button>
          <p className="text-sm text-muted-foreground">{t('supplementHint')}</p>
        </section>
      )}
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-semibold">{t('firstVersion')}</h2>
        {state?.firstVersionId ? (
          <Version
            id={state.firstVersionId}
            enabled={account === buyerId && state.downloadsAvailable && !state.protectedMapping}
            busy={busy}
            onClick={() => run((g) => download(state.firstVersionId!, g))}
          />
        ) : (
          <p>{t('emptyVersions')}</p>
        )}
        <h2 className="font-semibold">{t('supplements')}</h2>
        {state?.publishedVersionIds.map((id) => (
          <Version
            key={id}
            id={id}
            enabled={account === buyerId && state.downloadsAvailable && !state.protectedMapping}
            busy={busy}
            onClick={() => run((g) => download(id, g))}
          />
        ))}
        {grant && (
          <a
            className="block break-all underline"
            href={grant.url}
            target="_blank"
            rel="noreferrer"
          >
            {t('download')} — {grant.expiresAt}
          </a>
        )}
      </section>
      <EvidencePanel orderId={orderId} />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
function Version({
  id,
  enabled,
  busy,
  onClick
}: {
  id: string
  enabled: boolean
  busy: boolean
  onClick: () => void
}) {
  const t = useTranslations('web3')
  return (
    <div className="space-y-1">
      <p className="break-all font-mono text-xs">{id}</p>
      <Button variant="outline" disabled={busy || !enabled} onClick={onClick}>
        {t('download')}
      </Button>
    </div>
  )
}
