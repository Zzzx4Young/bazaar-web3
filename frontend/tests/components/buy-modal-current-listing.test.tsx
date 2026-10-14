import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BuyModal } from '@/components/listing/buy-modal'
import { useAuthStore } from '@/stores/use-auth-store'
import type { Item } from '@/types'

const id = '11111111-1111-4111-8111-111111111111'
const item: Item = {
  id,
  sellerId: 'seller-1',
  backendVersion: 1,
  title: 'Original title',
  description: 'Description',
  category: 'digital',
  tags: [],
  price: { amount: 10, exactAmount: '10.00', currency: 'USD' },
  media: [],
  status: 'active',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z'
}

function listing(changed = false) {
  return {
    id,
    seller: { id: 'seller-1', displayName: 'Seller' },
    type: 'digital',
    title: changed ? 'Updated title' : 'Original title',
    description: 'Description',
    category: 'digital_assets',
    price: { amount: changed ? '12.00' : '10.00', currency: 'USD' },
    priceUsd: null,
    publicationStatus: 'published',
    availability: 'unlimited',
    version: changed ? 2 : 1,
    licenseDescription: 'License',
    contentVersion: 'v1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z'
  }
}

function signIn() {
  useAuthStore.setState({
    status: 'authenticated',
    view: {
      account: { id: 'buyer-1', loginName: 'buyer', displayName: 'Buyer', role: 'participant' },
      csrfToken: 'csrf'
    },
    error: null
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
})

it('shows the current price and prevents confirmation when the listing changed before opening', async () => {
  signIn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(listing(true)), { status: 200 }))
  )

  render(<BuyModal item={item} open onOpenChange={() => {}} />)
  await waitFor(() => expect(screen.getByText('Updated title')).toBeInTheDocument())
  expect(screen.getByText('12.00 USD')).toBeInTheDocument()
  expect(screen.getByText('changed')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'confirm' })).toBeDisabled()
})

it('rechecks just before placing an order and stops when the price changes after opening', async () => {
  signIn()
  let serverChanged = false
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      if (url !== `/api/listings/${id}/detail`) throw new Error(`Unexpected URL: ${url}`)
      return new Response(JSON.stringify(listing(serverChanged)), { status: 200 })
    })
  )

  render(<BuyModal item={item} open onOpenChange={() => {}} />)
  const confirm = screen.getByRole('button', { name: 'confirm' })
  await waitFor(() => expect(confirm).toBeEnabled())
  const initialReads = requests.length
  serverChanged = true
  fireEvent.click(confirm)

  await waitFor(() => expect(screen.getByText('12.00 USD')).toBeInTheDocument())
  expect(requests.length).toBeGreaterThan(initialReads)
  expect(requests).not.toContain('/api/orders')
  expect(confirm).toBeDisabled()
})

it('blocks a listing that became unavailable', async () => {
  signIn()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...listing(),
            availability: 'sold'
          }),
          { status: 200 }
        )
    )
  )

  render(<BuyModal item={item} open onOpenChange={() => {}} />)
  await waitFor(() => expect(screen.getByText('unavailable')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'confirm' })).toBeDisabled()
})

it('places an order only after a second matching server read', async () => {
  signIn()
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      if (url === `/api/listings/${id}/detail`)
        return new Response(JSON.stringify(listing()), { status: 200 })
      if (url === '/api/orders')
        return new Response(JSON.stringify({ orderId: '33333333-3333-4333-8333-333333333333' }), {
          status: 201
        })
      throw new Error(`Unexpected URL: ${url}`)
    })
  )
  const onOpenChange = vi.fn()

  render(<BuyModal item={item} open onOpenChange={onOpenChange} />)
  const confirm = screen.getByRole('button', { name: 'confirm' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)

  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(requests.filter((url) => url === `/api/listings/${id}/detail`)).toHaveLength(2)
  expect(requests).toContain('/api/orders')
})

it('ignores a preflight response from an earlier opening of the same dialog', async () => {
  signIn()
  const requests: string[] = []
  let releasePreflight: ((response: Response) => void) | undefined
  let detailReads = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      if (url === `/api/listings/${id}/detail`) {
        detailReads += 1
        if (detailReads === 2)
          return new Promise<Response>((resolve) => {
            releasePreflight = resolve
          })
        return new Response(JSON.stringify(listing()), { status: 200 })
      }
      if (url === '/api/orders')
        return new Response(JSON.stringify({ orderId: 'order-1' }), { status: 201 })
      throw new Error(`Unexpected URL: ${url}`)
    })
  )

  const onOpenChange = vi.fn()
  const { rerender } = render(<BuyModal item={item} open onOpenChange={onOpenChange} />)
  const confirm = screen.getByRole('button', { name: 'confirm' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() => expect(detailReads).toBe(2))

  rerender(<BuyModal item={item} open={false} onOpenChange={onOpenChange} />)
  rerender(<BuyModal item={item} open onOpenChange={onOpenChange} />)
  await waitFor(() => expect(detailReads).toBe(3))
  await act(async () =>
    releasePreflight?.(new Response(JSON.stringify(listing()), { status: 200 }))
  )

  expect(requests).not.toContain('/api/orders')
  expect(onOpenChange).not.toHaveBeenCalledWith(false)
})
