import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PublishForm } from '@/components/publish/publish-form'
import { useAuthStore } from '@/stores/use-auth-store'

vi.mock('next-intl', async () => {
  const { default: messages } = await import('../../messages/zh-CN.json')
  return {
    useLocale: () => 'zh-CN',
    useTranslations:
      (namespace: keyof typeof messages) =>
      (key: string, values?: Record<string, string | number>) => {
        const catalog = messages[namespace] as Record<string, string>
        return (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
          String(values?.[name] ?? '')
        )
      }
  }
})

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

it('shows BZTEST separately for enabled one-off files and rejects excess precision before publishing', async () => {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url)
      return new Response(
        JSON.stringify(
          url === '/api/web3/config' ? { enabled: true } : [{ code: 'CNY', scale: 2 }]
        ),
        { status: 200 }
      )
    })
  )
  render(<PublishForm />)
  fireEvent.keyDown(screen.getByRole('tab', { name: '数字资产' }), { key: 'Enter' })
  fireEvent.change(await screen.findByLabelText('销售方式'), { target: { value: 'one_off' } })
  const price = await screen.findByLabelText('BZTEST 测试网价格（可选）')
  expect(screen.getByText(/测试资产，无真实资金交易/)).toBeInTheDocument()
  expect(screen.getByText(/不与上方报价换算/)).toBeInTheDocument()
  fireEvent.change(price, { target: { value: '1.0000001' } })
  fireEvent.click(screen.getByRole('button', { name: '立即发布' }))
  await screen.findByText('请输入大于零、最多 6 位小数的有效 BZTEST 价格')
  expect(requests).not.toContain('/api/listings')
})
