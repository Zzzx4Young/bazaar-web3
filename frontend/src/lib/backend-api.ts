import type { Item, ItemCategory, Currency } from '@/types'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001/api'
export interface BackendListing { id: string; seller: { id: string; displayName: string }; type: ItemCategory; title: string; description: string; category: string; price: { amount: string; currency: Currency }; priceUsd: string | null; publicationStatus: 'published' | 'withdrawn'; availability: string; version: number; licenseDescription: string | null; contentVersion: string | null; createdAt: string; updatedAt: string }
export interface ListingPage { items: BackendListing[]; page: number; limit: number; hasMore: boolean; quote: { id: string; base: 'USD'; provider: string; fetchedAt: string; expiresAt: string; sourceAsOf: string | null } | null }
export interface AuthView { account: { id: string; loginName: string; displayName: string }; csrfToken: string }
export async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } })
  if (!response.ok) { const error = await response.json().catch(() => ({ code: 'NETWORK_ERROR' })) as { code?: string }; throw new Error(error.code ?? `HTTP_${response.status}`) }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>
}
export function backendErrorCode(error: unknown) {
  return error instanceof Error ? error.message : 'NETWORK_ERROR'
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
export function toItem(listing: BackendListing): Item { return { id: listing.id, sellerId: listing.seller.id, title: listing.title, description: listing.description, category: listing.type, tags: [], price: { amount: Number(listing.price.amount), currency: listing.price.currency, fiatEstimate: listing.priceUsd ? Number(listing.priceUsd) : undefined }, media: [], status: listing.availability === 'sold' ? 'sold' : listing.availability === 'reserved' ? 'locked' : 'active', viewCount: 0, favoriteCount: 0, createdAt: listing.createdAt, updatedAt: listing.updatedAt } }
export async function fetchListings(params: URLSearchParams = new URLSearchParams()) {
  return backendPost<ListingPage>('/listings/search', Object.fromEntries(params.entries()))
}
