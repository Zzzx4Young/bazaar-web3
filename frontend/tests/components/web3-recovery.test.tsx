import { beforeEach, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { WalletControls } from '@/components/web3/wallet-controls'
import { PrivateFileUpload } from '@/components/web3/private-file-upload'
import { useAuthStore } from '@/stores/use-auth-store'
import zh from '@/../messages/zh-CN.json'
vi.unmock('next-intl')
const mocks = vi.hoisted(() => ({ post: vi.fn(), reload: vi.fn() }))
vi.mock('@/lib/authenticated-api', () => ({ authenticatedPost: mocks.post }))
vi.mock('@/hooks/use-api-resource', () => ({
  useApiResource: () => ({ data: { address: null, bindingVersion: 0 }, reload: mocks.reload })
}))
const a = '0x' + '11'.repeat(20)
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    status: 'authenticated',
    view: {
      csrfToken: 'session',
      account: { id: 'buyer', loginName: 'buyer', displayName: 'Buyer', role: 'participant' }
    }
  })
  Object.defineProperty(window, 'ethereum', {
    configurable: true,
    value: {
      request: vi.fn(async ({ method }: { method: string }) =>
        method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_getCode' ? '0x' : [a]
      )
    }
  })
})
const wrap = (v: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zh}>
      {v}
    </NextIntlClientProvider>
  )
it('explicit restart uses a new reauthentication flow, ordinary retry keeps original key', async () => {
  mocks.post.mockResolvedValue({ id: 'email' })
  wrap(<WalletControls chainId={11155111} />)
  await userEvent.click(screen.getByRole('button', { name: '连接钱包' }))
  await userEvent.click(screen.getByRole('button', { name: '向账户邮箱申请验证码' }))
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
  const original = mocks.post.mock.calls[0][2]
  await userEvent.click(screen.getByRole('button', { name: '向账户邮箱申请验证码' }))
  expect(mocks.post.mock.calls[1][2]).toBe(original)
  await userEvent.click(screen.getByRole('button', { name: '重新开始认证' }))
  await userEvent.click(screen.getByRole('button', { name: '向账户邮箱申请验证码' }))
  expect(mocks.post.mock.calls[2][2]).not.toBe(original)
})
it('retries completion after successful PUT without uploading bytes again', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetch)
  let completions = 0
  mocks.post.mockImplementation(async (path: string) => {
    if (path.endsWith('upload-intents'))
      return {
        uploadId: 'upload',
        uploadUrl: 'https://files.invalid/uploads/upload',
        uploadToken: 'token',
        contentType: 'application/pdf'
      }
    if (path.endsWith('/complete')) {
      if (++completions === 1) throw new Error('NETWORK_ERROR')
      return { status: 'checking' }
    }
    return { status: 'ready', versionId: 'version' }
  })
  const ready = vi.fn()
  wrap(<PrivateFileUpload orderId="order" purpose="delivery" onReady={ready} />)
  await userEvent.upload(
    screen.getByLabelText('上传私有文件'),
    new File(['%PDF-test'], 'test.pdf', { type: 'application/pdf' })
  )
  await userEvent.click(screen.getByRole('button', { name: '上传私有文件' }))
  await screen.findByRole('alert')
  await userEvent.click(screen.getByRole('button', { name: '上传私有文件' }))
  await waitFor(() => expect(ready).toHaveBeenCalledWith('version'))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(completions).toBe(2)
  await userEvent.upload(screen.getByLabelText('上传私有文件'), new File(['%PDF-second'], 'second.pdf', {type:'application/pdf'}))
  await userEvent.click(screen.getByRole('button', {name:'上传私有文件'}))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(completions).toBe(3))
  vi.unstubAllGlobals()
})
