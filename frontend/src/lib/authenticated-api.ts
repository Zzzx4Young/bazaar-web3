import { backendRequest, BackendError } from './backend-api'
import { useAuthStore } from '@/stores/use-auth-store'

function redirectToLogin() {
  if (typeof window === 'undefined') return
  const locale = window.location.pathname.match(/^\/(zh-CN|en)(?:\/|$)/)?.[1] ?? 'zh-CN'
  const returnTo = `${window.location.pathname}${window.location.search}`
  const target = `/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`
  if (!window.location.pathname.startsWith(`/${locale}/login`)) window.location.replace(target)
}

export async function authenticatedPost<T>(path: string, body: unknown = {}, key?: string) {
  const view = useAuthStore.getState().view
  if (!view) {
    redirectToLogin()
    throw new BackendError('UNAUTHENTICATED', 401)
  }
  try {
    return await backendRequest<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'X-CSRF-Token': view.csrfToken, ...(key ? { 'Idempotency-Key': key } : {}) }
    })
  } catch (error) {
    if (error instanceof BackendError && (error.status === 401 || error.status === 403)) {
      useAuthStore.getState().invalidate(view.csrfToken)
      redirectToLogin()
    }
    throw error
  }
}
