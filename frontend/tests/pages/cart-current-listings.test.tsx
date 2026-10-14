import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CartPage from '@/app/[locale]/cart/page'
import { useAuthStore } from '@/stores/use-auth-store'
import { useCartStore } from '@/stores/use-cart-store'

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const added = [firstId, secondId].map((listingId, index) => ({
  listingId,
  version: 1,
  title: index === 0 ? 'Old title' : 'Second title',
  type: 'digital' as const,
  amount: '10.00',
  currency: 'USD'
}))
const currentCartLines = added.map((line, index) => ({
  ...line,
  title: index === 0 ? 'Current title' : 'Second title'
}))

function currentListing(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    seller: { id: 'seller-1', displayName: 'Seller' },
    type: 'digital',
    title: id === firstId ? 'Current title' : 'Second title',
    description: 'Current description',
    category: 'digital_assets',
    price: { amount: '10.00', currency: 'USD' },
    priceUsd: null,
    publicationStatus: 'published',
    availability: 'unlimited',
    version: 1,
    licenseDescription: 'License',
    contentVersion: 'v1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides
  }
}

function setup(items: object[]) {
  sessionStorage.clear()
  useAuthStore.setState({
    status: 'authenticated',
    view: {
      account: { id: 'buyer-1', loginName: 'buyer', displayName: 'Buyer', role: 'participant' },
      csrfToken: 'csrf'
    },
    error: null
  })
  useCartStore.setState({ ownerId: 'buyer-1', items: items as typeof added })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sessionStorage.clear()
  useCartStore.setState({ ownerId: null, items: [] })
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
})

it('shows current server data and blocks checkout after a price or version change', async () => {
  setup(added)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/api/listings/favorites/resolve') throw new Error(`Unexpected URL: ${url}`)
      return new Response(
        JSON.stringify({
          items: [
            currentListing(firstId, { price: { amount: '12.00', currency: 'USD' }, version: 2 }),
            currentListing(secondId)
          ],
          total: 2
        }),
        { status: 200 }
      )
    })
  )

  render(<CartPage />)
  await waitFor(() => expect(screen.getByText('Current title')).toBeInTheDocument())
  expect(screen.getByText('12.00 USD')).toBeInTheDocument()
  expect(screen.getByText('listingChanged')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'checkout' })).toBeDisabled()
})

it('does not allow checkout when a saved listing is no longer published', async () => {
  setup(added)
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [currentListing(secondId)],
            total: 1
          }),
          { status: 200 }
        )
    )
  )

  render(<CartPage />)
  await waitFor(() => expect(screen.getByText('listingUnavailable')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'checkout' })).toBeDisabled()
})

it('keeps checkout disabled when current listing data cannot be read', async () => {
  setup(added)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ code: 'UNAVAILABLE' }), { status: 503 }))
  )

  render(<CartPage />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('refreshError'))
  expect(screen.getByRole('button', { name: 'checkout' })).toBeDisabled()
  expect(screen.getAllByText('savedListing')).toHaveLength(2)
  expect(screen.queryByRole('link', { name: 'Old title' })).not.toBeInTheDocument()
})

it('rechecks listings before checkout and does not place an order after a later price change', async () => {
  setup(currentCartLines)
  const requests: string[] = []
  let serverChanged = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      if (url !== '/api/listings/favorites/resolve') throw new Error(`Unexpected URL: ${url}`)
      return new Response(
        JSON.stringify({
          items: [
            currentListing(
              firstId,
              serverChanged ? { version: 2, price: { amount: '12.00', currency: 'USD' } } : {}
            ),
            currentListing(secondId)
          ],
          total: 2
        }),
        { status: 200 }
      )
    })
  )

  render(<CartPage />)
  const button = await screen.findByRole('button', { name: 'checkout' })
  await waitFor(() => expect(button).toBeEnabled())
  const initialReads = requests.length
  serverChanged = true
  fireEvent.click(button)

  await waitFor(() => expect(screen.getAllByText('listingChanged').length).toBeGreaterThan(0))
  expect(requests.length).toBeGreaterThan(initialReads)
  expect(requests).not.toContain('/api/checkouts')
  expect(button).toBeDisabled()
})

it('checks current listings again before a valid checkout and clears the cart after success', async () => {
  setup(currentCartLines)
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      if (url === '/api/listings/favorites/resolve')
        return new Response(
          JSON.stringify({
            items: [currentListing(firstId), currentListing(secondId)],
            total: 2
          }),
          { status: 200 }
        )
      if (url === '/api/checkouts')
        return new Response(
          JSON.stringify({
            checkoutId: '33333333-3333-4333-8333-333333333333',
            orderIds: []
          }),
          { status: 201 }
        )
      throw new Error(`Unexpected URL: ${url}`)
    })
  )

  render(<CartPage />)
  const button = await screen.findByRole('button', { name: 'checkout' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)

  await waitFor(() => expect(useCartStore.getState().items).toHaveLength(0))
  expect(requests.filter((url) => url === '/api/listings/favorites/resolve')).toHaveLength(2)
  expect(requests).toContain('/api/checkouts')
})
