import { expect, it } from 'vitest'
import { publicErrorCodes } from '../../../backend/src/common/error-codes'
import { apiErrorCodes } from '@/lib/api-error-codes'
import en from '../../messages/en.json'
import zh from '../../messages/zh-CN.json'
import openapi from '../../../backend/openapi/alpha.json'

it('keeps frontend error types aligned with the backend public codes', () => {
  expect(new Set(apiErrorCodes).size).toBe(apiErrorCodes.length)
  expect(new Set(publicErrorCodes).size).toBe(publicErrorCodes.length)
  expect([...apiErrorCodes].sort()).toEqual([...publicErrorCodes].sort())
  expect([...openapi.components.schemas.Error.properties.code.enum].sort())
    .toEqual([...publicErrorCodes].sort())
})

it('covers every public code with nonempty copy in each supported locale', () => {
  for (const catalog of [en.apiErrors, zh.apiErrors]) {
    for (const code of publicErrorCodes) {
      const copy = catalog[code]
      expect(copy.trim(), code).not.toBe('')
      expect(copy, code).not.toBe(code)
    }
  }
})
