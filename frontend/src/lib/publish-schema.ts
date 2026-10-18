import { z } from 'zod'
import { marketplaceCategories } from './categories'
import { listingTextPolicy } from './listing-policy'

export const publishSchema = z
  .object({
    title: z
      .string()
      .min(3, '标题至少 3 个字符')
      .refine(
        (value) => [...value].length <= listingTextPolicy.titleMaxLength,
        `标题最长 ${listingTextPolicy.titleMaxLength} 字符`
      ),
    description: z
      .string()
      .min(10, '描述至少 10 个字符')
      .refine(
        (value) => [...value].length <= listingTextPolicy.descriptionMaxLength,
        `描述最长 ${listingTextPolicy.descriptionMaxLength} 字符`
      ),
    category: z.enum(['physical', 'digital']),
    saleMode: z.enum(['one_off', 'repeatable']),
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
    priceCurrency: z.string().regex(/^[A-Z]{2,5}$/, '请选择有效币种'),
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
      if (
        [...(data.licenseDescription ?? '')].length > listingTextPolicy.licenseDescriptionMaxLength
      )
        issue(
          'licenseDescription',
          `授权说明最长 ${listingTextPolicy.licenseDescriptionMaxLength} 字符`
        )
      if ([...(data.contentVersion ?? '')].length > listingTextPolicy.contentVersionMaxLength)
        issue('contentVersion', `内容版本最长 ${listingTextPolicy.contentVersionMaxLength} 字符`)
    }
    if (data.category === 'physical' && data.saleMode !== 'one_off')
      issue('saleMode', '实物商品只能按单件销售')
  })
