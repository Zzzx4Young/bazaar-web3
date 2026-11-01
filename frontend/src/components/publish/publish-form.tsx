// 发布商品表单
'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useRouter } from '@/i18n/routing'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { marketplaceCategories } from '@/lib/categories'
import { publishSchema } from '@/lib/publish-schema'
import { useAuthStore } from '@/stores/use-auth-store'
import { BackendError, createListing, uploadListingImage } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'
import { useCurrencies } from '@/hooks/use-currencies'
import type { ItemCategory, Currency } from '@/types'
import { CommitmentEditor } from '@/components/listing/commitment-editor'
import { CommitmentView } from '@/components/listing/commitment-view'
import { initialDigitalCommitment, initialPhysicalCommitment, commitmentReady, type ProductCommitment } from '@/lib/commitment'

type FormValues = z.infer<typeof publishSchema>

export function PublishForm() {
  const locale = useLocale()
  const tUi = useTranslations('publishUi')
  const tCommitment = useTranslations('commitmentUi')
  const tCategory = useTranslations('marketCategories')
  const router = useRouter()
  const auth = useAuthStore()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [commitment, setCommitment] = useState<ProductCommitment>(initialPhysicalCommitment)
  const [replacementOfListingId, setReplacementOfListingId] = useState('')
  const { currencies, loading: currenciesLoading, error: currenciesError, retry } = useCurrencies()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: zodResolver(publishSchema),
    defaultValues: {
      category: 'physical',
      saleMode: 'one_off',
      primaryCategory: 'electronics',
      priceCurrency: 'CNY'
    }
  })

  const category = watch('category')
  const priceCurrency = watch('priceCurrency')
  const selectedPriceCurrency = currencies.find(({ code }) => code === priceCurrency)

  useEffect(() => {
    const fallbackCurrency = currencies[0]
    if (fallbackCurrency && !currencies.some(({ code }) => code === priceCurrency)) {
      setValue('priceCurrency', fallbackCurrency.code)
    }
  }, [currencies, priceCurrency, setValue])

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true)
    setSaveError(null)
    try {
      if (auth.status !== 'authenticated' || !auth.view) {
        setSaveError(tUi('signIn'))
        return
      }
      const selectedCurrency = currencies.find(({ code }) => code === data.priceCurrency)
      if (!selectedCurrency) {
        setSaveError(tUi('currencyPending'))
        return
      }
      if ((data.priceAmount.split('.')[1]?.length ?? 0) > selectedCurrency.scale) {
        setError('priceAmount', {
          type: 'validate',
          message: tUi('priceScale', {
            currency: selectedCurrency.code,
            scale: selectedCurrency.scale
          })
        })
        return
      }
      if (!commitmentReady(commitment)) {
        setSaveError(tCommitment('commitmentInvalid'))
        return
      }
      if (
        photos.length < 1 ||
        photos.length > 8 ||
        photos.some(
          (photo) =>
            !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
            photo.size < 1 ||
            photo.size > 5 * 1024 * 1024
        )
      ) {
        setSaveError(tUi('photoRule'))
        return
      }
      const mediaIds: string[] = []
      for (const photo of photos)
        mediaIds.push(await uploadListingImage(auth.view.csrfToken, photo))
      const listing = await createListing(auth.view.csrfToken, {
        type: data.category,
        saleMode: data.saleMode,
        title: data.title,
        description: data.description,
        category: data.primaryCategory,
        price: { amount: data.priceAmount, currency: data.priceCurrency },
        mediaIds,
        commitment,
        ...(data.saleMode === 'one_off' && replacementOfListingId.trim()
          ? { replacementOfListingId: replacementOfListingId.trim() } : {}),
        ...(data.category === 'digital'
          ? {
              supplyMode: data.saleMode === 'one_off' ? 'single' : 'unlimited',
              licenseDescription: data.licenseDescription,
              contentVersion: data.contentVersion
            }
          : {})
      })
      toast.success(listing.reviewStatus === 'paused'
        ? tCommitment('replacementReview') : tUi('success'))
      router.push(listing.reviewStatus === 'paused' ? '/me' : `/listing/${listing.id}`)
    } catch (error) {
      const message =
        error instanceof BackendError
          ? tUi('saveError', { error: apiErrorCopy(error, locale) })
          : error instanceof Error
            ? tUi('saveError', { error: error.message })
            : tUi('saveErrorGeneric')
      setSaveError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* 类型选择 */}
      <Card>
        <CardContent className="p-4">
          <Label className="mb-2 block">{tUi('itemType')}</Label>
          <Tabs
            value={category}
            onValueChange={(v) => {
              setValue('category', v as ItemCategory)
              setValue('saleMode', v === 'physical' ? 'one_off' : 'repeatable')
              setValue('primaryCategory', v === 'physical' ? 'electronics' : 'digital_assets')
              setCommitment(v === 'physical' ? initialPhysicalCommitment : initialDigitalCommitment)
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="physical">{tUi('physical')}</TabsTrigger>
              <TabsTrigger value="digital">{tUi('digital')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {category === 'digital' && (
        <div className="space-y-2">
          <Label htmlFor="saleMode">{tUi('saleMode')}</Label>
          <select
            id="saleMode"
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            {...register('saleMode')}
          >
            <option value="repeatable">{tUi('repeatable')}</option>
            <option value="one_off">{tUi('oneOff')}</option>
          </select>
          <p className="text-xs leading-5 text-muted-foreground">{tUi('saleModeHint')}</p>
          {errors.saleMode && <p className="text-sm text-destructive">{errors.saleMode.message}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="primaryCategory">{tUi('category')}</Label>
        <select
          id="primaryCategory"
          className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          {...register('primaryCategory')}
        >
          {marketplaceCategories
            .filter((c) => c.itemCategory === category)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {tCategory(c.id)}
              </option>
            ))}
        </select>
        {errors.primaryCategory && (
          <p role="alert" className="text-sm text-destructive">
            {errors.primaryCategory.message}
          </p>
        )}
      </div>

      {/* 基本信息 */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <Label htmlFor="title">{tUi('listingTitle')}</Label>
            <Input id="title" placeholder={tUi('titleHint')} {...register('title')} />
            {errors.title && (
              <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="description">{tUi('description')}</Label>
            <Textarea
              id="description"
              rows={6}
              placeholder={tUi('descriptionHint')}
              {...register('description')}
            />
            {errors.description && (
              <p className="mt-1 text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 商品图片 */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <Label htmlFor="listingPhotos">{tUi('photos')}</Label>
          <Input
            id="listingPhotos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => setPhotos(Array.from(event.target.files ?? []))}
          />
          {photos.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {tUi('selectedPhotos', { count: photos.length })}：
              {photos.map((photo) => photo.name).join('、')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 价格 */}
      <Card>
        <CardContent className="p-4">
          <Label className="mb-2 block">{tUi('price')}</Label>
          <div className="flex gap-2">
            <Input
              inputMode="decimal"
              placeholder="0.00"
              {...register('priceAmount')}
              className="flex-1"
            />
            <Select
              value={priceCurrency}
              onValueChange={(v) => setValue('priceCurrency', v as Currency)}
              disabled={currenciesLoading || !!currenciesError}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={tUi('loadingCurrencies')} />
              </SelectTrigger>
              <SelectContent>
                {currencies.map(({ code }) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedPriceCurrency && (
            <p className="mt-1 text-xs text-muted-foreground">
              {tUi('priceScale', { currency: priceCurrency, scale: selectedPriceCurrency.scale })}
            </p>
          )}
          {currenciesError && (
            <div role="alert" className="text-sm text-destructive">
              {tUi('currencyError', { error: currenciesError })}
              <Button type="button" variant="link" size="sm" onClick={retry}>
                {tUi('retry')}
              </Button>
            </div>
          )}
          {errors.priceAmount && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors.priceAmount.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 数字字段 */}
      {category === 'digital' && (
        <Card>
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold">{tUi('digitalTerms')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{tUi('sellerStatementHint')}</p>
            </div>
            <div>
              <Label htmlFor="licenseDescription">{tUi('license')}</Label>
              <Textarea
                id="licenseDescription"
                rows={3}
                placeholder={tUi('licenseHint')}
                {...register('licenseDescription')}
              />
              {errors.licenseDescription && (
                <p className="mt-1 text-xs text-destructive">{tUi('licenseRequired')}</p>
              )}
            </div>
            <div>
              <Label htmlFor="contentVersion">{tUi('version')}</Label>
              <Input
                id="contentVersion"
                placeholder={tUi('versionHint')}
                {...register('contentVersion')}
              />
              {errors.contentVersion && (
                <p className="mt-1 text-xs text-destructive">{tUi('versionRequired')}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {watch('saleMode') === 'one_off' && <label className="block text-sm">
        {tCommitment('replacementOfListingId')}
        <Input value={replacementOfListingId}
          onChange={(event) => setReplacementOfListingId(event.target.value)} />
      </label>}
      <CommitmentEditor type={category} value={commitment} onChange={setCommitment} />
      <div className="rounded-lg border p-4"><CommitmentView commitment={commitment} /></div>

      {saveError && (
        <p role="alert" className="text-destructive">
          {saveError}
        </p>
      )}
      {/* 提交 */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tUi('cancel')}
        </Button>
        <Button type="submit" disabled={submitting || currenciesLoading || !!currenciesError}>
          {submitting ? tUi('submitting') : tUi('submit')}
        </Button>
      </div>
    </form>
  )
}
