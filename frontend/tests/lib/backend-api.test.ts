import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendError, backendPost, toItem, type BackendListing } from '@/lib/backend-api'

afterEach(() => vi.unstubAllGlobals())

it('keeps refunded and unpublished listings unavailable in the UI', () => {
  const listing: BackendListing = {
    id: '11111111-1111-4111-8111-111111111111',
    seller: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Seller' },
    type: 'physical',
    title: 'Returned item',
    description: 'Awaiting inspection',
    category: 'electronics',
    price: { amount: '12.50', currency: 'USD' },
    priceUsd: null,
    publicationStatus: 'published',
    availability: 'refund_hold',
    version: 1,
    licenseDescription: null,
    contentVersion: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  }

  expect(toItem(listing).status).toBe('locked')
  expect(toItem({ ...listing, availability: 'available', publicationStatus: 'draft' }).status).toBe('locked')
  expect(toItem({ ...listing, availability: 'available', publicationStatus: 'archived' }).status).toBe('locked')
  expect(toItem({ ...listing, availability: 'sold' }).status).toBe('sold')
  expect(toItem({ ...listing, availability: 'available' }).status).toBe('active')
  expect(toItem(listing).price.fiatEstimate).toBeUndefined()
  expect(toItem({ ...listing, priceUsd: '13.27' }).price.fiatEstimate).toBe(13.27)
  expect(toItem(listing)).not.toHaveProperty('viewCount')
  expect(toItem(listing)).not.toHaveProperty('favoriteCount')
})

describe('backend request correlation', () => {
  it('sends a request ID and exposes the correlated error details', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
      return new Response(
        JSON.stringify({ code: 'UNAVAILABLE', retryable: true, requestId: 'server-request-1' }),
        { status: 409, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'server-request-1' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(backendPost('/listings/search')).rejects.toEqual(
      expect.objectContaining<Partial<BackendError>>({
        code: 'UNAVAILABLE',
        status: 409,
        requestId: 'server-request-1',
        retryable: true
      })
    )
  })

  it('keeps the sent request ID when the response is lost', async () => {
    let sentRequestId: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentRequestId = new Headers(init?.headers).get('X-Request-Id')
        throw new TypeError('connection lost')
      })
    )

    await expect(backendPost('/orders')).rejects.toEqual(
      expect.objectContaining<Partial<BackendError>>({
        code: 'NETWORK_ERROR',
        status: 0,
        requestId: sentRequestId,
        retryable: true
      })
    )
    expect(sentRequestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

it('maps current testnet eligibility conservatively without changing Alpha purchase eligibility', () => {
  const listing = {
    id: 'listing', seller: { id: 'seller', displayName: 'Seller' }, type: 'digital',
    saleMode: 'one_off', title: 'File', description: 'File', category: 'digital_assets',
    price: { amount: '1', currency: 'USD' }, priceUsd: null, publicationStatus: 'published',
    availability: 'available', version: 2, media: [], createdAt: '', updatedAt: '',
    purchaseEligible: true, testnetPurchaseEligible: true, testnetPurchaseBlockReason: null
  } as BackendListing
  expect(toItem(listing).testnetPurchaseEligible).toBe(true)
  expect(toItem({ ...listing, testnetPurchaseEligible: undefined }).testnetPurchaseEligible).toBe(false)
  const paused = toItem({ ...listing, testnetPurchaseEligible: false,
    testnetPurchaseBlockReason: 'payout_unconfirmed' })
  expect(paused.testnetPurchaseBlockReason).toBe('payout_unconfirmed')
  expect(paused.purchaseEligible).toBe(true)
})

it('maps missing and null testnet prices consistently and preserves integer-priced values', () => {
  const listing = {
    id: 'listing', seller: { id: 'seller', displayName: 'Seller' }, type: 'digital',
    title: 'File', description: 'File', category: 'digital_assets',
    price: { amount: '1', currency: 'USD' }, priceUsd: null, publicationStatus: 'published',
    availability: 'available', version: 1, media: [], createdAt: '', updatedAt: ''
  } as BackendListing
  expect(toItem(listing).testnetPrice).toBeNull()
  expect(toItem({ ...listing, testnetPrice: null }).testnetPrice).toBeNull()
  const price = { amount: '0.000001', amountAtoms: '1', currency: 'BZTEST' as const,
    decimals: 6 as const, chainId: 11155111, token: '0x' + '1'.repeat(40), escrow: '0x' + '2'.repeat(40) }
  expect(toItem({ ...listing, testnetPrice: price }).testnetPrice).toEqual(price)
})
