export const walletContinuationKey = 'bazaar:wallet-reauth'
export interface WalletContinuation {
  id: string
  key: string
  accountId: string
  purpose: 'bind' | 'unbind' | 'payout'
  address: string
  chainId: number
  expiresAt: string
}
export function readWalletContinuation(
  raw: string | null,
  accountId: string,
  now = Date.now()
): WalletContinuation | null {
  try {
    const r = JSON.parse(raw ?? 'null') as WalletContinuation
    if (
      !r ||
      r.accountId !== accountId ||
      !['bind', 'unbind', 'payout'].includes(r.purpose) ||
      !/^0x[0-9a-fA-F]{40}$/.test(r.address) ||
      !Number.isSafeInteger(r.chainId) ||
      r.chainId <= 0 ||
      !/^[-a-f0-9]{36}$/.test(r.id) ||
      !/^[-a-f0-9]{36}$/.test(r.key) ||
      !Number.isFinite(Date.parse(r.expiresAt)) ||
      now >= Date.parse(r.expiresAt)
    )
      return null
    return r
  } catch {
    return null
  }
}
export function googleAuthorizationUrl(value: string) {
  const url = new URL(value)
  if (
    url.origin !== 'https://accounts.google.com' ||
    url.pathname !== '/o/oauth2/v2/auth' ||
    url.username ||
    url.password
  )
    throw new Error('GOOGLE_INVALID')
  return url.toString()
}
