'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApiResource } from '@/hooks/use-api-resource'
import { authenticatedPost } from '@/lib/authenticated-api'
import { backendErrorMessage, type BackendListing, type ListingPage } from '@/lib/backend-api'

export function BackendListings() {
  const resource = useApiResource<ListingPage>(
    '/me/listings',
    { limit: '50', publicationStatus: 'published' },
    true
  )
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
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
    try {
      await authenticatedPost(`/listings/${listing.id}/edit`, {
        version: listing.version,
        ...(publicationStatus ? { publicationStatus } : { title, priceAmount: price })
      })
      setEditing(null)
      toast.success(publicationStatus === 'withdrawn' ? '商品已下架' : '商品已更新')
      resource.reload()
    } catch (failure) {
      const message = backendErrorMessage(failure)
      setError(message)
      toast.error(`更新失败：${message}`)
    }
  }
  const items = resource.data?.items ?? []
  if (!items.length) return <p className="text-sm text-muted-foreground">暂无已发布商品。</p>
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
              <div className="flex gap-2">
                <Button onClick={() => void save(listing)}>保存</Button>
                <Button variant="outline" onClick={() => setEditing(null)}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{listing.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {listing.price.amount} {listing.price.currency} · v{listing.version}
                  </p>
                </div>
                <span className="text-sm">{listing.publicationStatus}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(listing.id)
                    setTitle(listing.title)
                    setPrice(listing.price.amount)
                  }}
                >
                  编辑
                </Button>
                <Button variant="outline" onClick={() => void save(listing, 'withdrawn')}>
                  下架
                </Button>
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  )
}
