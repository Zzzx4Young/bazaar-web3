'use client'
import { useId, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authenticatedPost } from '@/lib/authenticated-api'
import { useAuthStore } from '@/stores/use-auth-store'
import { apiErrorCopy } from '@/lib/api-error-copy'
export function PrivateFileUpload({
  orderId,
  purpose,
  onReady
}: {
  orderId: string
  purpose: 'delivery' | 'evidence'
  onReady: (id: string) => void
}) {
  const t = useTranslations('web3'),
    locale = useLocale(),
    id = useId()
  const [upload, setUpload] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const file = useRef<File | null>(null),
    key = useRef(crypto.randomUUID())
  const accepted = useRef(false)
  const act = async (check = false) => {
    if (busy) return
    const token = useAuthStore.getState().view?.csrfToken
    const guard = () => {
      if (!token || token !== useAuthStore.getState().view?.csrfToken)
        throw new Error('UNAUTHENTICATED')
    }
    setBusy(true)
    setError('')
    try {
      let uploadId = upload
      if (!check) {
        const f = file.current
        if (!f) return
        const r = await authenticatedPost<{
          uploadId: string
          uploadUrl: string
          uploadToken: string
          contentType: string
          status?: string
        }>(
          '/web3/private-files/upload-intents',
          { orderId, purpose, filename: f.name, contentType: f.type, byteSize: f.size },
          key.current
        )
        guard()
        uploadId = r.uploadId
        setUpload(uploadId)
        if (!accepted.current && !['quarantined', 'checking', 'ready'].includes(r.status ?? '')) {
          const response = await fetch(r.uploadUrl, {
            method: 'PUT',
            credentials: 'omit',
            headers: { Authorization: 'Bearer ' + r.uploadToken, 'Content-Type': r.contentType },
            body: f
          })
          if (!response.ok) throw new Error('FILE_UNAVAILABLE')
          accepted.current = true
        }
      }
      guard()
      await authenticatedPost(`/web3/private-files/${uploadId}/complete`)
      guard()
      const r = await authenticatedPost<{ status: string; versionId: string | null }>(
        `/web3/private-files/${uploadId}/status`
      )
      guard()
      setStatus(r.status)
      if (r.status === 'ready' && r.versionId) onReady(r.versionId)
    } catch (e) {
      setError(apiErrorCopy(e, locale))
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset className="min-w-0 space-y-2 rounded-xl border p-4" disabled={busy}>
      <legend>{t('upload')}</legend>
      <p className="text-sm text-muted-foreground">{t('uploadHint')}</p>
      <label htmlFor={id}>{t('upload')}</label>
      <input
        id={id}
        type="file"
        className="block w-full min-w-0 text-sm"
        accept=".pdf,.png,.jpg,.jpeg,.zip"
        onChange={(e) => {
          accepted.current = false
          file.current = e.target.files?.[0] ?? null
          key.current = crypto.randomUUID()
          setUpload('')
          setStatus('')
          onReady('')
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => act()}>{t('upload')}</Button>
        <Button disabled={!upload} variant="outline" onClick={() => act(true)}>
          {t('check')}
        </Button>
      </div>
      {status && (
        <p role="status">
          {t('checking', {
            value: t.has('fileStates.' + status) ? t('fileStates.' + status) : t('pending')
          })}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  )
}
