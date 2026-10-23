import { locales } from '@/i18n/locales'

function localePrefixLength(path: string): number {
  for (const locale of locales) {
    const prefix = `/${locale}`
    const next = path[prefix.length]
    if (path.startsWith(prefix) &&
      (next === undefined || next === '/' || next === '?' || next === '#'))
      return prefix.length
  }
  return 0
}

const unsafeEncoding = /%(?:2f|5c|25|0[0-9a-f]|1[0-9a-f]|7f)/i
const dotSegment = /(?:^|\/)\.{1,2}(?=\/|$)/

export function resolveSafeReturnTo(returnTo?: string, fallback: '/' | '/me' = '/me'): string {
  if (!returnTo || /[\u0000-\u001f\u007f-\u009f\\]/.test(returnTo)) return fallback

  const path = returnTo.slice(localePrefixLength(returnTo)) || '/'
  const destination = path.startsWith('?') || path.startsWith('#') ? `/${path}` : path
  const pathname = destination.split(/[?#]/, 1)[0] ?? ''

  if (!pathname.startsWith('/') || pathname.startsWith('//') ||
    unsafeEncoding.test(pathname) || localePrefixLength(pathname) > 0) return fallback

  try {
    const decodedPath = decodeURIComponent(pathname)
    if (/[\u0000-\u001f\u007f-\u009f\\]/.test(decodedPath) ||
      decodedPath.startsWith('//') || dotSegment.test(decodedPath)) return fallback
    const parsed = new URL(destination, 'https://local.invalid')
    if (parsed.origin !== 'https://local.invalid' || parsed.pathname.startsWith('//'))
      return fallback
  } catch {
    return fallback
  }

  return destination
}
