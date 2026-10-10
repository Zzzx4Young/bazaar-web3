import { describe, expect, it } from 'vitest'
import { publishSchema } from '@/lib/publish-schema'

const digital = {
  title: 'Valid title',
  description: 'Valid description',
  category: 'digital',
  primaryCategory: 'digital_assets',
  priceAmount: '1',
  priceCurrency: 'USD',
  licenseDescription: 'Valid license',
  contentVersion: 'v1'
}

describe('publish form text contract', () => {
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
