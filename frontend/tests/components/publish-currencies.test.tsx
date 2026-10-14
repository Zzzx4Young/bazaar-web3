import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PublishForm } from '@/components/publish/publish-form'
import { useAuthStore } from '@/stores/use-auth-store'

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ status: 'anonymous', view: null, error: null })
})

it('selects the first currency returned by the backend when the default is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([{ code: 'BRL', scale: 2 }]), { status: 200 }))
  )
  render(<PublishForm />)
  await waitFor(() => expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('BRL'))
})

it('prevents publishing while the currency catalog is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'UNAVAILABLE' }), {
          status: 503
        })
    )
  )
  render(<PublishForm />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('币种加载失败'))
  expect(screen.getByRole('button', { name: '立即发布' })).toBeDisabled()
})

it('rejects excess decimal places using the server-provided currency scale', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    view: {
      account: { id: 'seller-1', loginName: 'seller', displayName: 'Seller', role: 'participant' },
      csrfToken: 'test-csrf'
    },
    error: null
  })
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      if (url !== '/api/currencies') throw new Error(`Unexpected request: ${url}`)
      return new Response(JSON.stringify([{ code: 'JPY', scale: 0 }]), { status: 200 })
    })
  )

  render(<PublishForm />)
  await waitFor(() => expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('JPY'))
  fireEvent.change(screen.getByRole('textbox', { name: '标题' }), {
    target: { value: 'Valid title' }
  })
  fireEvent.change(screen.getByRole('textbox', { name: '详细描述（支持 Markdown）' }), {
    target: { value: 'Valid description' }
  })
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1.5' } })
  fireEvent.click(screen.getByRole('button', { name: '立即发布' }))

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('JPY 最多支持 0 位小数'))
  expect(requests).toEqual(['/api/currencies'])
})
