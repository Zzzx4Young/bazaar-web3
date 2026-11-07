import { describe, expect, it } from 'vitest'
import { publishSchema } from '@/lib/publish-schema'

const digital = {
  title: 'Valid title',
  description: 'Valid description',
  category: 'digital',
  saleMode: 'repeatable',
  primaryCategory: 'digital_assets',
  priceAmount: '1',
  priceCurrency: 'USD',
  licenseDescription: 'Valid license',
  contentVersion: 'v1'
}

describe('publish form text contract', () => {
  it('leaves supported-currency membership to the server catalog', () => {
    expect(publishSchema.safeParse({ ...digital, priceCurrency: 'NZD' }).success).toBe(true)
    expect(publishSchema.safeParse({ ...digital, priceCurrency: '' }).success).toBe(false)
  })

  it('accepts maximum titles and descriptions, counting emoji as Unicode characters', () => {
    expect(
      publishSchema.safeParse({
        ...digital,
        title: '🧪'.repeat(100),
        description: '文'.repeat(5000)
      }).success
    ).toBe(true)
    expect(publishSchema.safeParse({ ...digital, title: '文'.repeat(101) }).success).toBe(false)
    expect(publishSchema.safeParse({ ...digital, description: '文'.repeat(5001) }).success).toBe(
      false
    )
  })

  it('rejects oversized digital fields before sending a request', () => {
    expect(
      publishSchema.safeParse({
        ...digital,
        licenseDescription: '文'.repeat(2000),
        contentVersion: '🧪'.repeat(100)
      }).success
    ).toBe(true)
    for (const patch of [
      { licenseDescription: '文'.repeat(2001) },
      { contentVersion: '文'.repeat(101) }
    ]) {
      expect(publishSchema.safeParse({ ...digital, ...patch }).success).toBe(false)
    }
  })
})

describe('BZTEST independent price', () => {
  it('accepts positive exact six-decimal prices only for one-off digital files', () => {
    const base = { ...digital, saleMode: 'one_off' }
    expect(publishSchema.safeParse({ ...base, testnetPriceAmount: '0.000001' }).success).toBe(true)
    for (const amount of ['0', '-1', '1e6', '1.0000001', ' 1', '9'.repeat(80)]) {
      expect(publishSchema.safeParse({ ...base, testnetPriceAmount: amount }).success).toBe(false)
    }
    expect(publishSchema.safeParse({ ...digital, testnetPriceAmount: '1' }).success).toBe(false)
    expect(publishSchema.safeParse({ ...base, testnetPriceAmount: '' }).success).toBe(true)
  })
})
