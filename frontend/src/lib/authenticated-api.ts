import { backendRequest, BackendError } from './backend-api'
import { useAuthStore } from '@/stores/use-auth-store'

export async function authenticatedPost<T>(path: string, body: unknown = {}, key?: string) {
  const view = useAuthStore.getState().view
  if (!view) throw new BackendError('UNAUTHENTICATED', 401)
  try {
    return await backendRequest<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'X-CSRF-Token': view.csrfToken, ...(key ? { 'Idempotency-Key': key } : {}) }
    })
  } catch (error) {
    if (error instanceof BackendError && error.status === 401) {
      useAuthStore.getState().invalidate(view.csrfToken)
    }
    throw error
  }
}
