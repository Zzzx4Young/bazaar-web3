import type { Item, ItemCategory, Currency } from '@/types'

const API_BASE = '/api'
export interface BackendListing {
  id: string
  seller: { id: string; displayName: string }
  type: ItemCategory
  title: string
  description: string
  category: string
  price: { amount: string; currency: Currency }
  priceUsd: string | null
  publicationStatus: 'published' | 'withdrawn' | 'draft' | 'archived'
  availability: string
  version: number
  licenseDescription: string | null
  contentVersion: string | null
  createdAt: string
  updatedAt: string
}
export interface ListingPage {
  items: BackendListing[]
  page: number
  limit: number
  total: number
  hasMore: boolean
  quote: {
    id: string
    base: 'USD'
    provider: string
    fetchedAt: string
    expiresAt: string
    sourceAsOf: string | null
  } | null
}
export interface AuthView {
  account: { id: string; loginName: string; displayName: string }
  csrfToken: string
}
export class BackendError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly requestId: string | null = null,
    public readonly retryable: boolean = false
  ) {
    super(code)
  }
}
export async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const requestId = globalThis.crypto?.randomUUID?.()
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(requestId ? { 'X-Request-Id': requestId } : {}),
        ...init?.headers
      }
    })
  } catch {
    throw new BackendError('NETWORK_ERROR', 0, requestId ?? null, true)
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ code: 'NETWORK_ERROR' }))) as {
      code?: string
      retryable?: boolean
      requestId?: string
    }
    throw new BackendError(
      error.code ?? `HTTP_${response.status}`,
      response.status,
      error.requestId ?? response.headers.get('X-Request-Id'),
      error.retryable === true
    )
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
}
export function backendErrorCode(error: unknown) {
  return error instanceof Error ? error.message : 'NETWORK_ERROR'
}
export function backendErrorMessage(error: unknown) {
  const code = backendErrorCode(error)
  return error instanceof BackendError && error.requestId
    ? `${code} · Request ID: ${error.requestId}`
    : code
}
export function login(loginName: string, password: string) {
  return backendPost<AuthView>('/auth/login', { loginName, password })
}
export function refreshSession() {
  return backendPost<AuthView>('/auth/session')
}
export function logout(csrfToken: string) {
  return backendRequest<void>('/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({})
  })
}
export function createListing(csrfToken: string, body: unknown) {
  return backendRequest<BackendListing>('/listings', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body)
  })
}
export async function backendPost<T>(path: string, body: unknown = {}) {
  return backendRequest<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
export function toItem(listing: BackendListing): Item {
  return {
    id: listing.id,
    backendVersion: listing.version,
    sellerId: listing.seller.id,
    sellerDisplayName: listing.seller.displayName,
    title: listing.title,
    description: listing.description,
    category: listing.type,
    primaryCategory: listing.category as Item['primaryCategory'],
    tags: [],
    licenseDescription: listing.licenseDescription ?? undefined,
    contentVersion: listing.contentVersion ?? undefined,
    price: {
      amount: Number(listing.price.amount),
      exactAmount: listing.price.amount,
      currency: listing.price.currency,
      fiatEstimate: listing.priceUsd ? Number(listing.priceUsd) : undefined
    },
    media: [],
    status:
      listing.availability === 'sold'
        ? 'sold'
        : listing.publicationStatus !== 'published' ||
            !['available', 'unlimited'].includes(listing.availability)
          ? 'locked'
          : 'active',
    viewCount: 0,
    favoriteCount: 0,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt
  }
}
export async function fetchListings(params: URLSearchParams = new URLSearchParams()) {
  return backendPost<ListingPage>('/listings/search', Object.fromEntries(params.entries()))
}
