'use client'
import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useApiResource } from '@/hooks/use-api-resource'
import { useAuthStore } from '@/stores/use-auth-store'
import { BackendError } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { buildPaymentCall, type IntentView } from '@/lib/web3/escrow-client'
import {
  assertWallet,
  injectedWallet,
  sendWalletTransaction,
  walletError
} from '@/lib/web3/wallet-client'
import { PaymentSteps, type PaymentStage } from './payment-steps'
export function IntentPanel({
  orderId,
  intentId,
  onRefresh
}: {
  orderId: string
  intentId: string
  onRefresh: () => void
}) {
  const t = useTranslations('web3'),
    locale = useLocale()
  const resource = useApiResource<IntentView>(`/web3/payment-intents/${intentId}/read`, {}, true)
  const [stage, setStage] = useState<PaymentStage>('idle'),
    [hash, setHash] = useState(''),
    [attempt, setAttempt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const approvalHash = useRef('')
  const inFlight = useRef(false)
  const keys = useRef(new Map<string, string>())
  const key = (op: string) => {
    let k = keys.current.get(op)
    if (!k) {
      k = crypto.randomUUID()
      keys.current.set(op, k)
    }
    return k
  }
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
    try {
      await fn(guard)
    } catch (e) {
      const k = walletError(e)
      if (k === 'unknown' && !(e instanceof BackendError)) setStage('pending')
      setError(e instanceof BackendError ? apiErrorCopy(e, locale) : t(k))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const send = async (action: 'approve' | 'deposit' | 'revokeIntent', guard: () => void) => {
    // Fresh server read before each send; never use an expired or cached signature.
    const view = await authenticatedPost<IntentView>(`/web3/payment-intents/${intentId}/read`)
    guard()
    if (!view.signature || !['issued', 'cancellation_pending'].includes(view.status))
      throw new Error('pending')
    const call =
      action === 'approve'
        ? buildPaymentCall('approve', view.permit)
        : buildPaymentCall(action, view.permit, view.signature)
    guard()
    const h = await sendWalletTransaction(
      injectedWallet(),
      view.permit.chainId,
      view.permit.buyer,
      call.to,
      call.data,
      guard
    )
    guard()
    setHash(h)
    setStage(action === 'approve' ? 'approvalSubmitted' : 'submitted')
    if (action === 'approve') approvalHash.current = h
    if (action !== 'approve') {
      const r = await authenticatedPost<{ id: string }>(
        `/web3/orders/${orderId}/transaction-attempts`,
        { txHash: h },
        key('attempt:' + h)
      )
      guard()
      setAttempt(r.id)
    }
  }
  const refresh = async (guard: () => void) => {
    if (approvalHash.current && !attempt && resource.data) {
      const p = injectedWallet()
      await assertWallet(p, resource.data.permit.chainId, resource.data.permit.buyer)
      guard()
      const receipt = (await p.request({
        method: 'eth_getTransactionReceipt',
        params: [approvalHash.current]
      })) as { status?: string } | null
      guard()
      if (receipt?.status === '0x1') setStage('approvalIncluded')
      else if (receipt?.status === '0x0') setStage('reverted')
    }
    if (attempt) {
      const r = await authenticatedPost<{ status: string }>(
        `/web3/transaction-attempts/${attempt}/refresh`
      )
      guard()
      setStage(
        r.status === 'finalized'
          ? 'included'
          : ['included', 'reverted', 'replaced'].includes(r.status)
            ? (r.status as PaymentStage)
            : 'pending'
      )
    }
    await authenticatedPost(`/web3/payment-intents/${intentId}/reconcile`)
    guard()
    resource.reload()
    onRefresh()
  }
  const view = resource.data
  return (
    <section className="space-y-3 rounded-xl border p-4">
      {resource.error && <p role="alert">{resource.error}</p>}
      {!view && <p>{t('loading')}</p>}
      {view && (
        <>
          <p>{t('intentDeadline', { value: String(view.permit.payDeadline) })}</p>
          <p className="break-all text-xs">
            {t('fixedBuyer')}: {view.permit.buyer}
          </p>
          <p className="break-all text-xs">
            {t('fixedSeller')}: {view.permit.seller}
          </p>
          <p>{t('walletBoundary')}</p>
          <PaymentSteps status={view.status === 'funded' ? 'finalized' : stage} hash={hash} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy ||
                view.status !== 'issued' ||
                ['submitted', 'included', 'pending'].includes(stage)
              }
              onClick={() => run((g) => send('approve', g))}
            >
              {t('approve')}
            </Button>
            <Button
              disabled={
                busy ||
                view.status !== 'issued' ||
                ['submitted', 'included', 'pending'].includes(stage)
              }
              onClick={() => run((g) => send('deposit', g))}
            >
              {t('pay')}
            </Button>
            <Button
              disabled={busy || !['issued', 'cancellation_pending'].includes(view.status)}
              variant="outline"
              onClick={() =>
                run(async (g) => {
                  await authenticatedPost(
                    `/web3/payment-intents/${intentId}/cancel`,
                    {},
                    key('cancel')
                  )
                  g()
                  await send('revokeIntent', g)
                })
              }
            >
              {t('cancel')}
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => run(refresh)}>
              {t('refresh')}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t('cancelHint')}</p>
          <p className="text-sm text-muted-foreground">{t('protection')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || view.status === 'funded'}
              onClick={() =>
                run(async (g) => {
                  await authenticatedPost(
                    `/web3/orders/${orderId}/payment-intents/replace`,
                    { previousIntentId: intentId },
                    key('replace')
                  )
                  g()
                  onRefresh()
                })
              }
            >
              {t('replace')}
            </Button>
            <Button
              variant="outline"
              disabled={busy || view.status === 'funded'}
              onClick={() =>
                run(async (g) => {
                  await authenticatedPost(`/web3/orders/${orderId}/cancel`, {}, key('close'))
                  g()
                  onRefresh()
                })
              }
            >
              {t('close')}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
