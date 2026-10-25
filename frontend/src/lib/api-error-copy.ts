import en from '../../messages/en.json'
import zh from '../../messages/zh-CN.json'
import { BackendError, backendErrorCode } from './backend-api'
import { type ApiErrorCode } from './api-error-codes'

const catalogs = { en: en.apiErrors, 'zh-CN': zh.apiErrors } satisfies Record<
  'en' | 'zh-CN', Record<ApiErrorCode, string>
>

// Keep machine-readable codes and request IDs in BackendError for diagnostics.
// Only catalog copy crosses the UI boundary.
export function apiErrorCopy(error: unknown, locale: string): string {
  const messages = locale === 'en' ? catalogs.en : catalogs['zh-CN']
  if (!(error instanceof Error) && typeof error !== 'string') return messages.UNKNOWN
  const code = typeof error === 'string' ? error : backendErrorCode(error)
  if (Object.prototype.hasOwnProperty.call(messages, code))
    return messages[code as keyof typeof messages]
  if (error instanceof BackendError) {
    const fallback = error.status === 429 ? 'RATE_LIMITED'
      : error.status === 400 ? 'INVALID_INPUT'
      : error.status === 401 ? 'UNAUTHENTICATED'
      : error.status === 403 ? 'FORBIDDEN'
      : error.status === 404 ? 'NOT_FOUND'
      : error.status === 409 ? 'CONFLICT'
      : error.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN'
    return messages[fallback]
  }
  return messages.UNKNOWN
}
