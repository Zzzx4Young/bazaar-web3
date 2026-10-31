'use client'

import { cartMaxItems } from '@/lib/cart-policy'
import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { transactionLabel } from '@/lib/transaction-copy'
import { Link, useRouter } from '@/i18n/routing'
import { Heart, Share2, MessageCircle } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { MediaCarousel } from '@/components/listing/media-carousel'
import { MarkdownRenderer } from '@/components/listing/markdown-renderer'
import { SellerCard } from '@/components/listing/seller-card'
import { ListingFacts } from '@/components/listing/listing-facts'
import { BuyModal } from '@/components/listing/buy-modal'
import { formatPrice, formatDate } from '@/lib/format'
import { useFavoriteStore } from '@/stores/use-favorite-store'
import { useBackendListing } from '@/hooks/use-backend-listing'
import { useAuthStore } from '@/stores/use-auth-store'
import { useCartStore } from '@/stores/use-cart-store'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import { authenticatedPost } from '@/lib/authenticated-api'

interface Props {
  params: { id: string }
}

export default function ListingDetailPage({ params }: Props) {
  const t = useTranslations('common')
  const tCart = useTranslations('commonCart')
  const tExplore = useTranslations('explore')
  const tFacts = useTranslations('listingFacts')
  const tPage = useTranslations('listingPage')
  const tCommitment = useTranslations('commitmentUi')
  const locale = useLocale()
  const router = useRouter()
  const backend = useBackendListing(params.id)
  const { toggle, isFavorite, error } = useFavoriteStore()
  const account = useAuthStore((state) => state.view?.account)
  const addToCart = useCartStore((state) => state.add)
  const cartOwnerId = useCartStore((state) => state.ownerId)
  const cartItems = useCartStore((state) => state.items)
  const [cartReady, setCartReady] = useState(false)
  useEffect(() => {
    void Promise.resolve(useCartStore.persist.rehydrate()).then(() => setCartReady(true))
  }, [])
  const [buyOpen, setBuyOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportKind, setReportKind] = useState<'source' | 'listing_rule'>('source')
  const [reporting, setReporting] = useState(false)
  const item = backend.item
  if (!item && backend.loading) {
    return <p role="status">{tPage('loading')}</p>
  }
  if (!item) {
    if (backend.error)
      return (
        <p role="alert" className="text-destructive">
          {tPage('loadError', { error: backend.error })}
        </p>
      )
    notFound()
  }
  const seller = { id: item.sellerId, displayName: item.sellerDisplayName ?? item.sellerId }
  const favorited = isFavorite(item.id)
  const currentCart = cartOwnerId === account?.id ? cartItems : []
  const alreadyInCart = currentCart.some((line) => line.listingId === item.id)

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {account && account.id !== item.sellerId && <div className="space-y-2 rounded-lg border p-4">
        <h2 className="font-medium">{tCommitment('reportLabel')}</h2>
        <select className="rounded-md border bg-background px-3 py-2 text-sm" value={reportKind}
          onChange={(event) => setReportKind(event.target.value as 'source' | 'listing_rule')}>
          <option value="source">{tCommitment('reportSource')}</option>
          <option value="listing_rule">{tCommitment('reportRule')}</option>
        </select>
        <Textarea aria-label={tCommitment('reportReason')} value={reportReason}
          onChange={(event) => setReportReason(event.target.value)} />
        <Button type="button" variant="outline" disabled={reporting || !reportReason.trim()}
          onClick={async () => {
            setReporting(true)
            try {
              await authenticatedPost(`/listings/${item.id}/report`,
                { kind: reportKind, reason: reportReason })
              toast.success(tCommitment('reportSent'))
              router.push('/explore')
            } catch { toast.error(tCommitment('reportError')) }
            finally { setReporting(false) }
          }}>{tCommitment('reportSubmit')}</Button>
      </div>}
      {/* 面包屑 */}
      <nav className="border-b border-border pb-5 text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          {tPage('home')}
        </Link>
        <span className="mx-1">/</span>
        <Link
          href={item.primaryCategory ? `/explore?category=${item.primaryCategory}` : '/explore'}
          className="hover:underline"
        >
          {item.category === 'physical' ? tPage('physical') : tPage('digital')}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-foreground">{item.title.slice(0, 20)}</span>
      </nav>

      <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
        {/* 左：媒体轮播 */}
        <MediaCarousel media={item.media} alt={item.title} illustrative={item.illustrativeImage} />

        {/* 右：价格 + 卖家 + 操作 */}
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge data-testid="acceptance-listing-status" variant="outline">
                {transactionLabel(item.status, locale)}
              </Badge>
              <Badge variant={item.category === 'digital' ? 'secondary' : 'outline'}>
                {item.category === 'digital' ? tPage('digital') : tPage('physical')}
              </Badge>
            </div>
            <h1 className="market-heading mt-4 text-3xl leading-tight sm:text-4xl">{item.title}</h1>
            <div className="mt-2 text-xs text-muted-foreground">
              {tPage('published', { date: formatDate(item.createdAt) })}
            </div>
          </div>

          <Card>
            <CardContent className="p-5 sm:p-6">
              <p className="market-eyebrow mb-3">{tExplore('editorial.price')}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  {formatPrice(item.price.exactAmount ?? item.price.amount, item.price.currency)}
                </span>
                {item.originalPrice && item.originalPrice.amount > item.price.amount && (
                  <span className="text-sm text-muted-foreground line-through">
                    {formatPrice(item.originalPrice.amount, item.originalPrice.currency)}
                  </span>
                )}
              </div>
              {item.price.fiatEstimate !== undefined && item.price.fiatEstimate > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  ≈ ${item.price.fiatEstimate.toLocaleString()} USD
                </div>
              )}
              {item.status !== 'active' && <p className="mt-3 text-sm text-muted-foreground">
                {tCommitment('unavailable')}
              </p>}
              <div className="mt-4 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    className="w-full"
                    size="lg"
                    disabled={item.status !== 'active'}
                    onClick={() => setBuyOpen(true)}
                  >
                    {tPage('buyNow')}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    size="lg"
                    disabled={
                      !cartReady ||
                      item.status !== 'active' ||
                      !account ||
                      account.role !== 'participant' ||
                      account.id === item.sellerId
                    }
                    onClick={() => {
                      if (!account) return
                      if (alreadyInCart) return toast.info(tCart('alreadyInCart'))
                      if (currentCart.length >= cartMaxItems)
                        return toast.error(tCart('full', { max: cartMaxItems }))
                      addToCart(account.id, item)
                      toast.success(tCart('added'))
                    }}
                  >
                    {alreadyInCart ? tCart('inCart') : tCart('addToCart')}
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <Button variant="outline" className="w-full" size="lg" disabled>
                    <MessageCircle className="mr-1 h-4 w-4" />
                    {tPage('contactUnavailable')}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    size="lg"
                    onClick={() => toggle(item.id)}
                  >
                    <Heart
                      className={`mr-1 h-4 w-4 ${favorited ? 'fill-red-500 text-red-500' : ''}`}
                    />
                    {favorited ? tPage('saved') : tPage('save')}
                  </Button>
                  <Button variant="outline" className="w-full" size="lg" disabled>
                    <Share2 className="mr-1 h-4 w-4" />
                    {t('shareUnavailable')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <SellerCard seller={seller} />

          <ListingFacts item={item} />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{tFacts('description')}</h2>
        <Card>
          <CardContent className="p-6">
            <MarkdownRenderer content={item.description} />
          </CardContent>
        </Card>
      </section>

      <BuyModal item={item} open={buyOpen} onOpenChange={setBuyOpen} />
    </div>
  )
}
