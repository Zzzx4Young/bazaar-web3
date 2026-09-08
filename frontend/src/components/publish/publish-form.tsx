// 发布商品表单
'use client'

import { useState } from 'react'
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
import { categories } from '@/lib/mock-data'
import { useItemStore } from '@/stores/use-item-store'
import { useUserStore } from '@/stores/use-user-store'
import type { ItemCategory, Currency, DigitalDeliveryType, ItemCondition, ShippingMethod } from '@/types'

const schema = z
  .object({
    title: z.string().min(3, '标题至少 3 个字符').max(80, '标题最长 80 字符'),
    description: z.string().min(10, '描述至少 10 个字符').max(2000, '描述最长 2000 字符'),
    category: z.enum(['physical', 'digital']),
    primaryCategory: z.enum(['electronics', 'digital_assets', 'software_source', 'game_items', 'secondhand_fashion']),
    priceAmount: z.coerce.number().positive('价格必须大于 0'),
    priceCurrency: z.enum(['CNY', 'USDT', 'ETH', 'SOL']),
    // 实物字段
    condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor']).optional(),
    shippingMethod: z.enum(['delivery', 'face_to_face']).optional(),
    // 数字字段
    deliveryType: z
      .enum(['download_link', 'license_key', 'cloud_link', 'account_credentials'])
      .optional(),
    deliveryContent: z.string().optional()
  })
  .superRefine((data, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    if (categories.find(category => category.id === data.primaryCategory)?.itemCategory !== data.category) {
      issue('primaryCategory', '请选择与商品类型匹配的分类')
    }
    if (data.category === 'physical') {
      if (!data.condition) issue('condition', '请选择物品成色')
      if (!data.shippingMethod) issue('shippingMethod', '请选择交易方式')
    } else {
      if (!data.deliveryType) issue('deliveryType', '请选择交付方式')
      if (!data.deliveryContent || data.deliveryContent.trim().length < 3) issue('deliveryContent', '请填写交付示例（至少 3 个字符）')
    }
  })

type FormValues = z.infer<typeof schema>

export function PublishForm() {
  const router = useRouter()
  const user = useUserStore(s => s.user)
  const { add: addItem, hydrated } = useItemStore()
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
      priceCurrency: 'CNY',
      shippingMethod: 'delivery'
    }
  })

  const category = watch('category')

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true)
    setSaveError(null)
    const id = `item_user_${Date.now()}`
    const now = new Date().toISOString()
    const item = {
      id,
      sellerId: user.linkedSellerId ?? user.id,
      title: data.title,
      description: data.description,
      category: data.category as ItemCategory,
      primaryCategory: data.primaryCategory,
      tags: [],
      price: {
        amount: data.priceAmount,
        currency: data.priceCurrency as Currency
      },
      media: [
        {
          type: 'image' as const,
          url: `https://placehold.co/600x400/222/fff?text=${encodeURIComponent(data.title.slice(0, 10))}`,
          alt: data.title
        }
      ],
      status: 'active' as const,
      viewCount: 0,
      favoriteCount: 0,
      createdAt: now,
      updatedAt: now,
      ...(data.category === 'physical'
        ? {
            condition: data.condition as ItemCondition,
            shippingMethod: data.shippingMethod as ShippingMethod
          }
        : {
            deliveryType: data.deliveryType as DigitalDeliveryType,
            deliveryPreview: data.deliveryContent
          })
    }
    try {
      addItem(item)
      router.push(`/listing/${id}`)
    } catch {
      setSaveError('无法保存商品，请检查浏览器存储空间或权限后重试。')
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
            onValueChange={v => {
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
        <select id="primaryCategory" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" {...register('primaryCategory')}>
          {categories.filter(c => c.itemCategory === category).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {errors.primaryCategory && <p role="alert" className="text-sm text-destructive">{errors.primaryCategory.message}</p>}
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
              type="number"
              step="0.01"
              placeholder="0.00"
              {...register('priceAmount')}
              className="flex-1"
            />
            <Select
              value={watch('priceCurrency')}
              onValueChange={v => setValue('priceCurrency', v as Currency)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CNY">CNY</SelectItem>
                <SelectItem value="USDT">USDT</SelectItem>
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

      {/* 实物字段 */}
      {category === 'physical' && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <Label>物品成色</Label>
              <Select
                value={watch('condition')}
                onValueChange={v => setValue('condition', v as ItemCondition)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择成色" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">全新</SelectItem>
                  <SelectItem value="like_new">99新</SelectItem>
                  <SelectItem value="good">95新</SelectItem>
                  <SelectItem value="fair">9成新</SelectItem>
                  <SelectItem value="poor">8成新</SelectItem>
                </SelectContent>
              </Select>
              {errors.condition && (
                <p className="mt-1 text-xs text-destructive">请选择物品成色</p>
              )}
            </div>
            <div>
              <Label>交易方式</Label>
              <Select
                value={watch('shippingMethod') ?? 'delivery'}
                onValueChange={v => setValue('shippingMethod', v as ShippingMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">快递发货 / 同城面交</SelectItem>
                  <SelectItem value="face_to_face">仅限同城面交</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 数字字段 */}
      {category === 'digital' && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <Label>交付方式</Label>
              <Select
                value={watch('deliveryType')}
                onValueChange={v => setValue('deliveryType', v as DigitalDeliveryType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择交付方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="download_link">下载链接（GitHub / 网盘）</SelectItem>
                  <SelectItem value="license_key">卡密 / 许可证</SelectItem>
                  <SelectItem value="cloud_link">网盘链接</SelectItem>
                  <SelectItem value="account_credentials">账号凭证</SelectItem>
                </SelectContent>
              </Select>
              {errors.deliveryType && (
                <p className="mt-1 text-xs text-destructive">请选择交付方式</p>
              )}
            </div>
            <div>
              <Label htmlFor="deliveryContent">交付示例（演示用）</Label>
              <Textarea
                id="deliveryContent"
                rows={3}
                placeholder="填写虚构链接或示例文本，不要填写真实账号或密钥"
                {...register('deliveryContent')}
              />
              {errors.deliveryContent && (
                <p className="mt-1 text-xs text-destructive">
                  请填写交付示例（至少 3 个字符）
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {saveError && <p role="alert" className="text-destructive">{saveError}</p>}
      {/* 提交 */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          取消
        </Button>
        <Button type="submit" disabled={submitting || !hydrated}>
          {submitting ? '发布中...' : '立即发布'}
        </Button>
      </div>
    </form>
  )
}
