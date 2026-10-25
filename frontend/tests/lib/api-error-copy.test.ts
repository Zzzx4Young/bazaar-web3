import { expect, it } from 'vitest'
import { BackendError } from '@/lib/backend-api'
import { apiErrorCopy } from '@/lib/api-error-copy'

it('uses localized copy without exposing response codes or request IDs', () => {
  const failure = new BackendError('RATE_LIMITED', 429, 'secret-request-id', true)
  expect(apiErrorCopy(failure, 'zh-CN')).toBe('操作过于频繁，请稍后再试。')
  expect(apiErrorCopy(failure, 'en')).toBe('Too many requests. Please try again later.')
  expect(apiErrorCopy(new BackendError('NEW_PRIVATE_CODE', 500, 'secret-request-id'), 'zh-CN'))
    .toBe('服务暂时不可用，请稍后重试。')
  expect(apiErrorCopy(new BackendError('NEW_PRIVATE_CODE', 409), 'en'))
    .toBe('The content has changed. Refresh and try again.')
  expect(apiErrorCopy(new BackendError('NEW_PRIVATE_CODE', 429), 'en'))
    .toBe('Too many requests. Please try again later.')
  expect(apiErrorCopy(new BackendError('MEDIA_LIMIT_REACHED', 429), 'en'))
    .toBe('The image limit has been reached.')
  expect(apiErrorCopy(undefined, 'zh-CN')).toBe('操作未完成，请稍后重试。')
})

it('keeps validation and retry guidance specific', () => {
  expect(apiErrorCopy(new BackendError('INVALID_INPUT', 400), 'zh-CN'))
    .toBe('填写的信息有误，请检查后重试。')
  expect(apiErrorCopy('RETRY_PENDING_COMMAND', 'en'))
    .toBe('Retry or complete the previous pending action first.')
})
