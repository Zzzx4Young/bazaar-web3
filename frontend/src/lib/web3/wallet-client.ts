export interface WalletProvider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}
export function injectedWallet(): WalletProvider {
  const provider = (window as Window & { ethereum?: WalletProvider }).ethereum
  if (!provider) throw new Error('noWallet')
  return provider
}
export async function assertWallet(provider: WalletProvider, chainId: number, expected?: string) {
  const chain = await provider.request({ method: 'eth_chainId' })
  if (typeof chain !== 'string' || BigInt(chain) !== BigInt(chainId)) throw new Error('wrongChain')
  const accounts = await provider.request({ method: 'eth_accounts' })
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])
  )
    throw new Error('noWallet')
  const address = accounts[0].toLowerCase()
  if (expected && address !== expected.toLowerCase()) throw new Error('wrongWallet')
  const code = await provider.request({ method: 'eth_getCode', params: [address, 'latest'] })
  if (code !== '0x') throw new Error('unsupportedAccount')
  // Detect account/chain changes that happened during the account-type read.
  const chainAfter = await provider.request({ method: 'eth_chainId' })
  const after = await provider.request({ method: 'eth_accounts' })
  if (chainAfter !== chain || !Array.isArray(after) || after[0]?.toLowerCase() !== address)
    throw new Error('walletChanged')
  return address
}
export async function connectWallet(provider: WalletProvider, chainId: number) {
  await provider.request({ method: 'eth_requestAccounts' })
  return assertWallet(provider, chainId)
}
export async function sendWalletTransaction(
  provider: WalletProvider,
  chainId: number,
  from: string,
  to: string,
  data: string,
  guard?: () => void
) {
  const account = await assertWallet(provider, chainId, from)
  guard?.()
  const hash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: account, to, data, value: '0x0', chainId: '0x' + chainId.toString(16) }]
  })
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('unknown')
  return hash
}
export async function signWalletData(
  provider: WalletProvider,
  chainId: number,
  address: string,
  typedData: unknown,
  guard?: () => void
) {
  if (!typedData || typeof typedData !== 'object' || !('domain' in typedData))
    throw new Error('unknown')
  const domain = typedData.domain as { chainId?: unknown }
  if (Number(domain?.chainId) !== chainId) throw new Error('wrongChain')
  const account = await assertWallet(provider, chainId, address)
  guard?.()
  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(typedData)]
  })
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error('unknown')
  return signature
}
export function walletError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001)
    return 'rejected'
  if (
    error instanceof Error &&
    ['noWallet', 'wrongChain', 'wrongWallet', 'unsupportedAccount', 'walletChanged'].includes(
      error.message
    )
  )
    return error.message
  return 'unknown'
}

export async function signWalletMessage(
  provider: WalletProvider,
  chainId: number,
  address: string,
  message: string,
  guard: () => void
) {
  if (!message || message.length > 4096) throw new Error('unknown')
  const account = await assertWallet(provider, chainId, address)
  guard()
  const hex =
    '0x' +
    Array.from(new TextEncoder().encode(message), (v) => v.toString(16).padStart(2, '0')).join('')
  const signature = await provider.request({ method: 'personal_sign', params: [hex, account] })
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error('unknown')
  return signature
}
