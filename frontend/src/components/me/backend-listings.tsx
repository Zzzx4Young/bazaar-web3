'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useApiResource } from '@/hooks/use-api-resource'
import { authenticatedPost } from '@/lib/authenticated-api'
import { backendErrorMessage, uploadListingImage, type BackendListing, type ListingPage } from '@/lib/backend-api'
import { useLocale } from 'next-intl'
import { transactionLabel } from '@/lib/transaction-copy'
import { useAuthStore } from '@/stores/use-auth-store'
import { useStoredPage } from '@/hooks/use-stored-page'
import { RecordPagination } from '@/components/ui/record-pagination'
import { paginationPolicy } from '@/lib/pagination'

export function BackendListings() {
  const locale = useLocale()
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
  const [photos, setPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const csrfToken = useAuthStore((state) => state.view?.csrfToken)
  const [error, setError] = useState<string>()
  if (resource.loading) return <p role="status">正在加载我的商品…</p>
  if (resource.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        商品加载失败：{resource.error}
      </p>
    )
  const save = async (listing: BackendListing, publicationStatus?: 'published' | 'withdrawn') => {
    setError(undefined)
    setSaving(true)
    try {
      if (photos.length > 8 || photos.some((photo) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
        photo.size < 1 || photo.size > 5 * 1024 * 1024))
        throw new Error('请选择至多 8 张 JPEG、PNG 或 WebP 图片，每张不超过 5 MiB。')
      if (!publicationStatus && photos.length && !csrfToken) throw new Error('请重新登录后上传图片。')
      const mediaIds = publicationStatus || !photos.length ? undefined : [] as string[]
      if (mediaIds && csrfToken) {
        for (const photo of photos) mediaIds.push(await uploadListingImage(csrfToken, photo))
      }
      await authenticatedPost(`/listings/${listing.id}/edit`, {
        version: listing.version,
        ...(publicationStatus ? { publicationStatus } : {
          title, description, priceAmount: price,
          ...(mediaIds ? { mediaIds } : {})
        })
      })
      setEditing(null)
      setPhotos([])
      toast.success(publicationStatus === 'withdrawn' ? '商品已下架' : '商品已更新')
      resource.reload()
    } catch (failure) {
      const message = backendErrorMessage(failure)
      setError(message)
      toast.error(`更新失败：${message}`)
    } finally {
      setSaving(false)
    }
  }
  const items = resource.data?.items ?? []
  if (!items.length && page === 1) return <p className="text-sm text-muted-foreground">暂无已发布商品。</p>
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          更新失败：{error}
        </p>
      )}
      {items.map((listing) => (
        <article key={listing.id} className="rounded-lg border p-4">
          {editing === listing.id ? (
            <div className="space-y-2">
              <Input
                aria-label="商品标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Input
                aria-label="商品价格"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
              />
              <Textarea aria-label="商品描述" value={description}
                onChange={(event) => setDescription(event.target.value)} />
              <p className="text-xs text-muted-foreground">更换图片会保留历史订单中的原图。</p>
              <Input aria-label="更换商品图片" type="file" multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} />
              <p className="text-xs text-muted-foreground">已选 {photos.length} 张新图片；不选则保留当前图片。</p>
              <div className="flex gap-2">
                <Button disabled={saving} onClick={() => void save(listing)}>保存</Button>
                <Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-medium">{listing.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {listing.price.amount} {listing.price.currency} · v{listing.version} · {listing.saleMode === 'one_off' ? '仅售一次' : '可重复销售'}
                  </p>
                  {listing.media[0] && <img src={listing.media[0].url} alt={listing.title}
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
                      setPhotos([])
                    }}
                  >
                    编辑
                  </Button>
                ) : (
                  <span className="self-center text-xs text-muted-foreground">
                    已有订单，一次性商品不可编辑
                  </span>
                )}
                <Button variant="outline" disabled={saving} onClick={() => void save(listing, 'withdrawn')}>
                  下架
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
