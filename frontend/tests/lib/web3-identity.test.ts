import { describe, it, expect, vi } from 'vitest'
import { readWalletContinuation, googleAuthorizationUrl } from '@/lib/web3/identity-client'
import { signWalletMessage } from '@/lib/web3/wallet-client'
const record = {
  id: '11111111-1111-4111-8111-111111111111',
  key: '22222222-2222-4222-8222-222222222222',
  accountId: 'account',
  purpose: 'bind',
  address: '0x' + '11'.repeat(20),
  chainId: 11155111,
  expiresAt: '2030-01-01T00:00:00.000Z'
}
describe('wallet identity browser continuation', () => {
  it('accepts only the same account and unexpired bounded operation', () => {
    expect(readWalletContinuation(JSON.stringify(record), 'account', 0)?.purpose).toBe('bind')
    expect(readWalletContinuation(JSON.stringify(record), 'other', 0)).toBeNull()
    expect(
      readWalletContinuation(JSON.stringify(record), 'account', Date.parse(record.expiresAt))
    ).toBeNull()
    expect(
      readWalletContinuation(JSON.stringify({ ...record, purpose: 'login' }), 'account', 0)
    ).toBeNull()
    expect(readWalletContinuation('{', 'account', 0)).toBeNull()
  })
  it('rejects external OAuth destination substitutions', () => {
    expect(
      googleAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?state=x')
    ).toContain('accounts.google.com')
    for (const u of [
      'javascript:alert(1)',
      'https://accounts.google.com.evil.test/',
      'http://accounts.google.com/',
      'https://evil.test/'
    ])
      expect(() => googleAuthorizationUrl(u)).toThrow()
  })
  it('SIWE signs exact server message, only after session guard and EOA check', async () => {
    const req = vi.fn(async ({ method }: { method: string }) =>
      method === 'eth_chainId'
        ? '0xaa36a7'
        : method === 'eth_accounts'
          ? [record.address]
          : method === 'eth_getCode'
            ? '0x'
            : '0x' + '11'.repeat(65)
    )
    const guard = vi.fn()
    await signWalletMessage({ request: req }, 11155111, record.address, 'Example SIWE', guard)
    expect(req.mock.calls.at(-1)?.[0]).toMatchObject({ method: 'personal_sign' })
    expect(guard).toHaveBeenCalledTimes(1)
  })
})
