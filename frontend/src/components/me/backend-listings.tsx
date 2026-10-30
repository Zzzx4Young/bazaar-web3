'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useApiResource } from '@/hooks/use-api-resource'
import { authenticatedPost } from '@/lib/authenticated-api'
import { BackendError, uploadListingImage, type BackendListing, type ListingPage } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { useLocale, useTranslations } from 'next-intl'
import { transactionLabel } from '@/lib/transaction-copy'
import { useAuthStore } from '@/stores/use-auth-store'
import { useStoredPage } from '@/hooks/use-stored-page'
import { RecordPagination } from '@/components/ui/record-pagination'
import { paginationPolicy } from '@/lib/pagination'

export function BackendListings() {
  const locale = useLocale()
  const t = useTranslations('myListings')
  const accountId = useAuthStore((state) => state.view?.account.id)
  const [page, setPage] = useStoredPage(`bazaar:listings:${accountId ?? 'guest'}`)
  const resource = useApiResource<ListingPage>(
    '/me/listings',
    { page: String(page), limit: String(paginationPolicy.defaultLimit), publicationStatus: 'published' },
    true
  )
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [licenseDescription, setLicenseDescription] = useState('')
  const [contentVersion, setContentVersion] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const csrfToken = useAuthStore((state) => state.view?.csrfToken)
  const [error, setError] = useState<string>()
  if (resource.loading) return <p role="status">{t('loading')}</p>
  if (resource.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('loadError', { error: resource.error })}
      </p>
    )
  const save = async (listing: BackendListing, publicationStatus?: 'published' | 'withdrawn') => {
    setError(undefined)
    setSaving(true)
    try {
      if (photos.length > 8 || photos.some((photo) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
        photo.size < 1 || photo.size > 5 * 1024 * 1024))
        throw new Error(t('invalidImages'))
      if (!publicationStatus && photos.length && !csrfToken) throw new Error(t('signInAgain'))
      const mediaIds = publicationStatus || !photos.length ? undefined : [] as string[]
      if (mediaIds && csrfToken) {
        for (const photo of photos) mediaIds.push(await uploadListingImage(csrfToken, photo))
      }
      await authenticatedPost(`/listings/${listing.id}/edit`, {
        version: listing.version,
        ...(publicationStatus ? { publicationStatus } : {
          title, description, priceAmount: price,
          ...(listing.type === 'digital' ? { licenseDescription, contentVersion } : {}),
          ...(mediaIds ? { mediaIds } : {})
        })
      })
      setEditing(null)
      setPhotos([])
      toast.success(t(publicationStatus === 'withdrawn' ? 'withdrawn' : 'updated'))
      resource.reload()
    } catch (failure) {
      const message = failure instanceof BackendError ? apiErrorCopy(failure, locale)
        : failure instanceof Error ? failure.message : apiErrorCopy(failure, locale)
      setError(message)
      toast.error(t('updateError', { error: message }))
    } finally {
      setSaving(false)
    }
  }
  const items = resource.data?.items ?? []
  if (!items.length && page === 1) return <p className="text-sm text-muted-foreground">{t('empty')}</p>
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('updateError', { error })}
        </p>
      )}
      {items.map((listing) => (
        <article key={listing.id} className="rounded-lg border p-4">
          {editing === listing.id ? (
            <div className="space-y-2">
              <Input
                aria-label={t('title')}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Input
                aria-label={t('price')}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
              />
              <Textarea aria-label={t('description')} value={description}
                onChange={(event) => setDescription(event.target.value)} />
              {listing.type === 'digital' && (
                <>
                  <Textarea aria-label={t('license')} value={licenseDescription}
                    onChange={(event) => setLicenseDescription(event.target.value)} />
                  <Input aria-label={t('contentVersion')} value={contentVersion}
                    onChange={(event) => setContentVersion(event.target.value)} />
                </>
              )}
              <p className="text-xs text-muted-foreground">{t('imageNotice')}</p>
              <Input aria-label={t('replaceImages')} type="file" multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} />
              <p className="text-xs text-muted-foreground">{t('selectedImages', { count: photos.length })}</p>
              <div className="flex gap-2">
                <Button disabled={saving} onClick={() => void save(listing)}>{t('save')}</Button>
                <Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-medium">{listing.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {listing.price.amount} {listing.price.currency} · v{listing.version} · {t(listing.saleMode === 'one_off' ? 'oneOff' : 'repeatable')}
                  </p>
                  {listing.media[0] && <img src={listing.media[0].url} alt={listing.title} width={80} height={80}
                    className="mt-2 h-20 w-20 rounded object-cover" />}
                </div>
                <span className="shrink-0 text-sm">{transactionLabel(listing.publicationStatus, locale)}</span>
              </div>
              <div className="mt-3 flex gap-2">
                {listing.canEdit ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(listing.id)
                      setTitle(listing.title)
                      setPrice(listing.price.amount)
                      setDescription(listing.description)
                      setLicenseDescription(listing.licenseDescription ?? '')
                      setContentVersion(listing.contentVersion ?? '')
                      setPhotos([])
                    }}
                  >
                    {t('edit')}
                  </Button>
                ) : (
                  <span className="self-center text-xs text-muted-foreground">
                    {t('locked')}
                  </span>
                )}
                <Button variant="outline" disabled={saving} onClick={() => void save(listing, 'withdrawn')}>
                  {t('withdraw')}
                </Button>
              </div>
            </>
          )}
        </article>
      ))}
      <RecordPagination page={page} limit={resource.data?.limit ?? 20}
        total={resource.data?.total ?? 0} hasMore={resource.data?.hasMore ?? false}
        onPageChange={setPage} />
    </div>
  )
}
