import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { assertWallet, sendWalletTransaction, walletError } from '@/lib/web3/wallet-client'
import { buildPaymentCall, buildDirectPackage } from '@/lib/web3/escrow-client'
const a = '0x' + '11'.repeat(20)
const b = '0x' + '22'.repeat(20)
const hash = '0x' + '33'.repeat(32)
function provider(chain = '0xaa36a7', accounts = [a]) {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return chain
      if (method === 'eth_accounts') return accounts
      if (method === 'eth_getCode') return '0x'
      if (method === 'eth_sendTransaction') return hash
      throw new Error(method)
    })
  }
}
describe('testnet wallet boundary', () => {
  it('accepts only target chain, exact fixed EOA account', async () => {
    await expect(assertWallet(provider(), 11155111, a)).resolves.toBe(a)
    await expect(assertWallet(provider('0x1'), 11155111, a)).rejects.toThrow('wrongChain')
    await expect(assertWallet(provider(undefined, [b]), 11155111, a)).rejects.toThrow('wrongWallet')
  })
  it('fails closed when account type cannot be read or is nonempty', async () => {
    const p = provider()
    p.request.mockImplementation(async ({ method }) =>
      method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_accounts' ? [a] : '0x1234'
    )
    await expect(assertWallet(p, 11155111, a)).rejects.toThrow('unsupportedAccount')
  })
  it('rechecks wallet immediately before send, never silently switches', async () => {
    const p = provider(undefined, [b])
    await expect(sendWalletTransaction(p, 11155111, a, b, '0x')).rejects.toThrow('wrongWallet')
    expect(p.request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false)
  })
  it('rejection and timeout are not payment failure', () => {
    expect(walletError({ code: 4001 })).toBe('rejected')
    expect(walletError(new Error('timeout'))).toBe('unknown')
  })
  it('builds exact amount approval, never infinite', () => {
    const call = buildPaymentCall('approve', { token: a, escrow: b, amountAtoms: '1234567' })
    expect(call.to).toBe(a)
    expect(call.data.endsWith(BigInt(1234567).toString(16).padStart(64, '0'))).toBe(true)
  })
  it('offline package does not depend on downloads', () => {
    const p = buildDirectPackage({
      chainId: 11155111,
      escrow: b,
      chainOrderId: hash,
      buyer: a,
      seller: b,
      refundAddress: a
    })
    expect(p.actions.find((x) => x.action === 'openDispute')?.data).toMatch(/^0x/)
    expect(JSON.stringify(p)).not.toContain('token=')
    expect(p.chainId).toBe(11155111)
  })
})

it('frontend transaction ABI matches the frozen backend ABI exactly', () => {
  const front = readFileSync(resolve(process.cwd(), 'src/lib/web3/escrow-abi.ts'), 'utf8')
  const back = readFileSync(resolve(process.cwd(), '../backend/src/web3/escrow-abi.ts'), 'utf8')
  expect(front).toBe(back)
})

it('does not send when the application session changes during wallet checks', async () => {
  let valid = true
  const p = provider()
  p.request.mockImplementation(async ({ method }) => {
    if (method === 'eth_chainId') return '0xaa36a7'
    if (method === 'eth_accounts') return [a]
    if (method === 'eth_getCode') {
      valid = false
      return '0x'
    }
    return hash
  })
  const guard = () => {
    if (!valid) throw new Error('walletChanged')
  }
  await expect(sendWalletTransaction(p, 11155111, a, b, '0x', guard)).rejects.toThrow(
    'walletChanged'
  )
  expect(p.request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false)
})
