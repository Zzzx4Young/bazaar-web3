// 发布商品表单
'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
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

type FormValues = z.infer<typeof publishSchema>

export function PublishForm() {
  const locale = useLocale()
  const router = useRouter()
  const auth = useAuthStore()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
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
        setSaveError('请先登录后再发布商品。')
        return
      }
      const selectedCurrency = currencies.find(({ code }) => code === data.priceCurrency)
      if (!selectedCurrency) {
        setSaveError('币种列表尚未加载，请重试。')
        return
      }
      if ((data.priceAmount.split('.')[1]?.length ?? 0) > selectedCurrency.scale) {
        setError('priceAmount', {
          type: 'validate',
          message: `${selectedCurrency.code} 最多支持 ${selectedCurrency.scale} 位小数`
        })
        return
      }
      if (photos.length < 1 || photos.length > 8 || photos.some((photo) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
        photo.size < 1 || photo.size > 5 * 1024 * 1024)) {
        setSaveError('请选择 1–8 张 JPEG、PNG 或 WebP 图片，每张不超过 5 MiB。')
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
        ...(data.category === 'digital'
          ? {
              supplyMode: data.saleMode === 'one_off' ? 'single' : 'unlimited',
              licenseDescription: data.licenseDescription,
              contentVersion: data.contentVersion
            }
          : {})
      })
      toast.success('商品发布成功')
      router.push(`/listing/${listing.id}`)
    } catch (error) {
      const message = error instanceof BackendError
        ? `发布失败：${apiErrorCopy(error, locale)}`
        : error instanceof Error ? `发布失败：${error.message}` : '发布失败，请稍后重试。'
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
          <Label className="mb-2 block">商品类型</Label>
          <Tabs
            value={category}
            onValueChange={(v) => {
              setValue('category', v as ItemCategory)
              setValue('saleMode', v === 'physical' ? 'one_off' : 'repeatable')
              setValue('primaryCategory', v === 'physical' ? 'electronics' : 'digital_assets')
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="physical">实物二手</TabsTrigger>
              <TabsTrigger value="digital">数字资产</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {category === 'digital' && (
        <div className="space-y-2">
          <Label htmlFor="saleMode">销售方式</Label>
          <select
            id="saleMode"
            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
            {...register('saleMode')}
          >
            <option value="repeatable">可重复销售</option>
            <option value="one_off">仅售一次</option>
          </select>
          {errors.saleMode && <p className="text-sm text-destructive">{errors.saleMode.message}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="primaryCategory">商品分类</Label>
        <select
          id="primaryCategory"
          className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
          {...register('primaryCategory')}
        >
          {marketplaceCategories
            .filter((c) => c.itemCategory === category)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
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
            <Label htmlFor="title">标题</Label>
            <Input id="title" placeholder="一句话描述商品" {...register('title')} />
            {errors.title && (
              <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="description">详细描述（支持 Markdown）</Label>
            <Textarea
              id="description"
              rows={6}
              placeholder="## 商品详情&#10;- 规格&#10;- 配件&#10;- 交易说明"
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
          <Label htmlFor="listingPhotos">商品图片（1–8 张，每张不超过 5 MiB）</Label>
          <Input
            id="listingPhotos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => setPhotos(Array.from(event.target.files ?? []))}
          />
          {photos.length > 0 && (
            <p className="text-sm text-muted-foreground">已选择 {photos.length} 张：{photos.map((photo) => photo.name).join('、')}</p>
          )}
        </CardContent>
      </Card>

      {/* 价格 */}
      <Card>
        <CardContent className="p-4">
          <Label className="mb-2 block">价格</Label>
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
                <SelectValue placeholder="加载币种中..." />
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
              {priceCurrency} 最多支持 {selectedPriceCurrency.scale} 位小数
            </p>
          )}
          {currenciesError && (
            <div role="alert" className="text-sm text-destructive">
              币种加载失败：{currenciesError}
              <Button type="button" variant="link" size="sm" onClick={retry}>
                重试
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
          <CardContent className="space-y-4 p-4">
            <div>
              <Label htmlFor="licenseDescription">授权说明</Label>
              <Textarea
                id="licenseDescription"
                rows={3}
                placeholder="说明买家获得的使用授权，不要填写实际交付链接或密钥"
                {...register('licenseDescription')}
              />
              {errors.licenseDescription && (
                <p className="mt-1 text-xs text-destructive">请填写授权说明（至少 3 个字符）</p>
              )}
            </div>
            <div>
              <Label htmlFor="contentVersion">内容版本</Label>
              <Input id="contentVersion" placeholder="例如 v1.0" {...register('contentVersion')} />
              {errors.contentVersion && (
                <p className="mt-1 text-xs text-destructive">请填写内容版本</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {saveError && (
        <p role="alert" className="text-destructive">
          {saveError}
        </p>
      )}
      {/* 提交 */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          取消
        </Button>
        <Button type="submit" disabled={submitting || currenciesLoading || !!currenciesError}>
          {submitting ? '发布中...' : '立即发布'}
        </Button>
      </div>
    </form>
  )
}
