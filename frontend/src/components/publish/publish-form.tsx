// 发布商品表单
'use client'

import { useState } from 'react'
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
import { useAuthStore } from '@/stores/use-auth-store'
import { createListing } from '@/lib/backend-api'
import type { ItemCategory, Currency } from '@/types'

const schema = z
  .object({
    title: z.string().min(3, '标题至少 3 个字符').max(80, '标题最长 80 字符'),
    description: z.string().min(10, '描述至少 10 个字符').max(2000, '描述最长 2000 字符'),
    category: z.enum(['physical', 'digital']),
    primaryCategory: z.enum([
      'electronics',
      'digital_assets',
      'software_source',
      'game_items',
      'secondhand_fashion'
    ]),
    priceAmount: z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, '请输入不使用指数格式的正数')
      .refine((value) => /[1-9]/.test(value), '价格必须大于 0'),
    priceCurrency: z.enum([
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'CNY',
      'CAD',
      'AUD',
      'CHF',
      'HKD',
      'SGD',
      'KRW',
      'INR',
      'AED',
      'BRL',
      'BTC',
      'ETH',
      'USDT',
      'USDC',
      'SOL'
    ]),
    // 数字字段
    licenseDescription: z.string().optional(),
    contentVersion: z.string().optional()
  })
  .superRefine((data, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    if (
      marketplaceCategories.find((category) => category.id === data.primaryCategory)
        ?.itemCategory !== data.category
    ) {
      issue('primaryCategory', '请选择与商品类型匹配的分类')
    }
    if (data.category === 'digital') {
      if (!data.licenseDescription || data.licenseDescription.trim().length < 3)
        issue('licenseDescription', '请填写授权说明（至少 3 个字符）')
      if (!data.contentVersion || data.contentVersion.trim().length < 1)
        issue('contentVersion', '请填写内容版本')
    }
  })

type FormValues = z.infer<typeof schema>

export function PublishForm() {
  const router = useRouter()
  const auth = useAuthStore()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: 'physical',
      primaryCategory: 'electronics',
      priceCurrency: 'CNY'
    }
  })

  const category = watch('category')

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true)
    setSaveError(null)
    try {
      if (auth.status !== 'authenticated' || !auth.view) {
        setSaveError('请先登录后再发布商品。')
        return
      }
      const listing = await createListing(auth.view.csrfToken, {
        type: data.category,
        title: data.title,
        description: data.description,
        category: data.primaryCategory,
        price: { amount: data.priceAmount, currency: data.priceCurrency },
        ...(data.category === 'digital'
          ? {
              licenseDescription: data.licenseDescription,
              contentVersion: data.contentVersion
            }
          : {})
      })
      toast.success('商品发布成功')
      router.push(`/listing/${listing.id}`)
    } catch (error) {
      const message =
        error instanceof Error ? `发布失败：${error.message}` : '发布失败，请稍后重试。'
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
              value={watch('priceCurrency')}
              onValueChange={(v) => setValue('priceCurrency', v as Currency)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="CNY">CNY</SelectItem>
                <SelectItem value="USDT">USDT</SelectItem>
                <SelectItem value="USDC">USDC</SelectItem>
                <SelectItem value="BTC">BTC</SelectItem>
                <SelectItem value="ETH">ETH</SelectItem>
                <SelectItem value="SOL">SOL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {errors.priceAmount && (
            <p className="mt-1 text-xs text-destructive">{errors.priceAmount.message}</p>
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
        <Button type="submit" disabled={submitting}>
          {submitting ? '发布中...' : '立即发布'}
        </Button>
      </div>
    </form>
  )
}
