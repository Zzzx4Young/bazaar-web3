import { expect, it, vi } from 'vitest'

vi.mock('@/i18n/locales', () => ({ locales: ['zh-CN', 'en', 'fr'] }))

import { resolveSafeReturnTo } from '@/lib/safe-return-to'

it('uses the configured locales when removing a return path prefix', () => {
  expect(resolveSafeReturnTo('/fr/dashboard?tab=profile')).toBe('/dashboard?tab=profile')
  expect(resolveSafeReturnTo('/french/dashboard')).toBe('/french/dashboard')
  expect(resolveSafeReturnTo('/fr//example.com')).toBe('/me')
  expect(resolveSafeReturnTo('/fr/fr/dashboard')).toBe('/me')
})
