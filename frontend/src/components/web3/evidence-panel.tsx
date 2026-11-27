'use client'
import { useId, useState, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useApiResource } from '@/hooks/use-api-resource'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { PrivateFileUpload } from './private-file-upload'
interface Evidence {
  id: string
  text: string
  versionId: string | null
  attachment: { available: boolean; filename?: string } | null
}
export function EvidencePanel({ orderId }: { orderId: string }) {
  const t = useTranslations('web3'),
    locale = useLocale(),
    id = useId()
  const resource = useApiResource<{ evidence: Evidence[] }>(
    `/web3/orders/${orderId}/evidence/read`,
    {},
    true
  )
  const [text, setText] = useState(''),
    [version, setVersion] = useState(''),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const key = useRef(crypto.randomUUID())
  const submit = async () => {
    if (busy) return
    const token = useAuthStore.getState().view?.csrfToken
    setBusy(true)
    setError('')
    try {
      await authenticatedPost(
        `/web3/orders/${orderId}/evidence`,
        { ...(text ? { text } : {}), ...(version ? { versionId: version } : {}), consent },
        key.current
      )
      if (!token || token !== useAuthStore.getState().view?.csrfToken) return
      setText('')
      setConsent(false)
      setVersion('')
      key.current = crypto.randomUUID()
      resource.reload()
    } catch (e) {
      setError(apiErrorCopy(e, locale))
    } finally {
      setBusy(false)
    }
  }
  const download = async (evidenceId: string) => {
    const token = useAuthStore.getState().view?.csrfToken
    try {
      const r = await authenticatedPost<{ url: string }>(
        `/web3/orders/${orderId}/evidence/attachments/authorize`,
        { evidenceId }
      )
      if (!token || token !== useAuthStore.getState().view?.csrfToken) return
      window.open(r.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(apiErrorCopy(e, locale))
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">{t('evidence')}</h2>
      <p className="text-sm text-muted-foreground">{t('evidenceNotice')}</p>
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.data?.evidence.map((e) => (
        <article key={e.id} className="rounded-lg border p-3">
          <p className="whitespace-pre-wrap break-words">{e.text}</p>
          {e.attachment?.available && (
            <Button variant="outline" onClick={() => download(e.id)}>
              {t('attachment')}
            </Button>
          )}
        </article>
      ))}
      <label htmlFor={id + 'text'}>{t('text')}</label>
      <Textarea
        id={id + 'text'}
        maxLength={10000}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          key.current = crypto.randomUUID()
        }}
      />
      <PrivateFileUpload
        orderId={orderId}
        purpose="evidence"
        onReady={(v) => {
          setVersion(v)
          key.current = crypto.randomUUID()
        }}
      />
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {t('consent')}
      </label>
      <Button disabled={busy || !consent || (!text.trim() && !version)} onClick={submit}>
        {t('submitEvidence')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
