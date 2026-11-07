import { randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { DomainError } from '../common/domain-error.js'
import type { EvmAddress, Web3Config } from '../web3/web3-types.js'

type RpcRequest = (endpoint: string, method: string, params: string[]) => Promise<unknown>
const request: RpcRequest = async (endpoint, method, params) => {
  const id = randomUUID()
  const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
  if (!response.ok || !response.body) throw new Error('RPC unavailable')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let length = 0, text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 65_536) throw new Error('RPC reply exceeds budget')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally { await reader.cancel() }
  const body = JSON.parse(text) as { id?: string; jsonrpc?: string; error?: unknown; result?: unknown }
  if (!body || body.id !== id || body.jsonrpc !== '2.0' || body.error || !('result' in body))
    throw new Error('Invalid RPC reply')
  return body.result
}

// This is an admission check, not payment finality or a guarantee that an EOA
// cannot delegate later. Re-run it for login and signed binding operations.
export function createEoaChecker(config: Pick<Web3Config, 'chainId' | 'rpcPrimary' | 'rpcSecondary'>,
  rpc: RpcRequest = request) {
  return async (address: EvmAddress) => {
    let sources: { chain: unknown; latest: unknown; finalized: unknown }[]
    try {
      sources = await Promise.all([config.rpcPrimary, config.rpcSecondary].map(async endpoint => {
        const [chain, latest, finalized] = await Promise.all([
          rpc(endpoint, 'eth_chainId', []), rpc(endpoint, 'eth_getCode', [address, 'latest']),
          rpc(endpoint, 'eth_getCode', [address, 'finalized'])
        ])
        return { chain, latest, finalized }
      }))
    } catch { throw new DomainError('WALLET_UNAVAILABLE') }
    for (const source of sources) {
      if (typeof source.chain !== 'string' || !/^0x[0-9a-f]+$/i.test(source.chain) ||
        BigInt(source.chain) !== BigInt(config.chainId) ||
        typeof source.latest !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(source.latest) ||
        typeof source.finalized !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(source.finalized))
        throw new DomainError('WALLET_UNAVAILABLE')
    }
    if (sources[0].latest !== sources[1].latest || sources[0].finalized !== sources[1].finalized)
      throw new DomainError('WALLET_UNAVAILABLE')
    if (sources.some(source => source.latest !== '0x' || source.finalized !== '0x'))
      throw new DomainError('INVALID_INPUT')
  }
}
