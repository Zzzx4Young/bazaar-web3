import type { AttemptObservation } from './transaction-attempt.js'
import {
  encodeFunctionData,
  decodeFunctionResult,
  decodeEventLog,
  keccak256,
  erc20Abi,
  type Abi,
  type Hex
} from 'viem'
import { escrowAbi } from './escrow-abi.js'
import type { PaymentPermit } from './web3-types.js'
import type { VerifiedIntentState } from './payment-observer.js'
import type { ObservedOrder, VerifiedRange, VerifiedEvent } from './escrow-state.js'
import { randomUUID, createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'
import type { Bytes32, EvmAddress, FinalizedSnapshot, Web3Config } from './web3-types.js'
export interface ChainDeployment {
  deploymentBlock: string
  escrowCodeHash: Bytes32
  tokenCodeHash: Bytes32
  administrator: EvmAddress
  arbitrator: EvmAddress
}
export type ChainRpc = (
  endpoint: string,
  method: string,
  params: readonly unknown[]
) => Promise<unknown>
export class ChainVerificationError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'contradiction',
    readonly reason: string,
    readonly evidence?: Record<string, unknown>
  ) {
    super('Chain verification ' + kind + ': ' + reason)
  }
}
export function contradiction(reason: string, evidence?: Record<string, unknown>): never {
  throw new ChainVerificationError('contradiction', reason, evidence)
}
export function unavailable(reason: string): never {
  throw new ChainVerificationError('unavailable', reason)
}
export function quantity(v: unknown): bigint {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v) || v.length > 66)
    return contradiction('invalid quantity')
  return BigInt(v)
}
export function hash32(v: unknown): Bytes32 {
  if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v)) return contradiction('invalid hash')
  return v.toLowerCase() as Bytes32
}
export const hexNumber = (v: bigint) => '0x' + v.toString(16)
function canonical(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)])
    )
  return v
}
export const stable = (v: unknown): string => JSON.stringify(canonical(v))
export function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return contradiction('missing RPC object')
  return v as Record<string, unknown>
}
export interface VerifiedBlock {
  height: string
  hash: Bytes32
  parentHash: Bytes32
  timestamp: number
}
export function parseBlock(v: unknown): VerifiedBlock {
  const x = object(v),
    height = quantity(x.number),
    time = quantity(x.timestamp)
  if (time > BigInt(Number.MAX_SAFE_INTEGER)) return contradiction('block time overflow')
  return {
    height: height.toString(),
    hash: hash32(x.hash),
    parentHash: hash32(x.parentHash),
    timestamp: Number(time)
  }
}
export const chainRpc: ChainRpc = async (endpoint, method, params) => {
  const id = randomUUID()
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    })
    if (!response.ok || !response.body) return unavailable('RPC HTTP failure')
    const reader = response.body.getReader(),
      decoder = new TextDecoder()
    let text = '',
      size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 8_000_000) return unavailable('RPC response budget')
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      await reader.cancel()
    }
    const body = object(JSON.parse(text))
    if (body.jsonrpc !== '2.0' || body.id !== id || body.error || !('result' in body))
      return unavailable('RPC error or invalid envelope')
    return body.result
  } catch (e) {
    if (e instanceof ChainVerificationError) throw e
    return unavailable('RPC transport failure')
  }
}
export class DualChainObserver {
  private readonly history = new Map<
    string,
    { head: VerifiedBlock; anchors: Map<string, VerifiedBlock> }
  >()
  private async historicalAncestor(source: string, head: VerifiedBlock, target: bigint) {
    let proof = this.history.get(source)
    if (proof && proof.head.hash !== head.hash) {
      if (proof.head.height === head.height)
        return contradiction('finalized historical root changed')
      if (
        BigInt(head.height) > BigInt(proof.head.height) &&
        BigInt(head.height) - BigInt(proof.head.height) <= 512n
      ) {
        const linked = await this.ancestor(source, head, BigInt(proof.head.height))
        if (linked.hash !== proof.head.hash)
          return contradiction('finalized historical ancestry changed')
        proof.head = head
        proof.anchors.set(head.height, head)
      } else proof = undefined
    }
    if (!proof) {
      proof = { head, anchors: new Map([[head.height, head]]) }
      this.history.set(source, proof)
    }
    let current = [...proof.anchors.values()]
      .filter((b) => BigInt(b.height) >= target)
      .sort((a, b) => (BigInt(a.height) < BigInt(b.height) ? -1 : 1))[0]
    if (!current) return unavailable('historical anchor missing')
    let steps = 0
    while (BigInt(current.height) > target) {
      if (steps++ >= 512) {
        proof.anchors.set(current.height, current)
        return unavailable('historical ancestry pending; retry preserves validation progress')
      }
      const parent = parseBlock(
        await this.request(source, 'eth_getBlockByHash', [current.parentHash, false])
      )
      if (
        parent.hash !== current.parentHash ||
        BigInt(parent.height) + 1n !== BigInt(current.height) ||
        parent.timestamp > current.timestamp
      )
        return contradiction('historical ancestry mismatch')
      current = parent
      if (BigInt(current.height) % 128n === 0n) proof.anchors.set(current.height, current)
    }
    proof.anchors.set(current.height, current)
    if (proof.anchors.size > 20000)
      return unavailable('historical proof memory budget; controlled backfill required')
    return current
  }

  constructor(
    readonly config: Pick<
      Web3Config,
      'chainId' | 'token' | 'escrow' | 'rpcPrimary' | 'rpcSecondary'
    >,
    readonly deployment: ChainDeployment,
    readonly rpc: ChainRpc = chainRpc
  ) {}
  async request(endpoint: string, method: string, params: readonly unknown[]) {
    try {
      return await this.rpc(endpoint, method, params)
    } catch (e) {
      if (e instanceof ChainVerificationError) throw e
      return unavailable('source request failed')
    }
  }
  get sources(): readonly [string, string] {
    return [this.config.rpcPrimary, this.config.rpcSecondary]
  }
  private async ancestor(endpoint: string, head: VerifiedBlock, height: bigint) {
    let current = head
    if (BigInt(head.height) - height > 512n)
      return unavailable('ancestry budget; retry when heads converge')
    while (BigInt(current.height) > height) {
      const parent = parseBlock(
        await this.request(endpoint, 'eth_getBlockByHash', [current.parentHash, false])
      )
      if (
        parent.hash !== current.parentHash ||
        BigInt(parent.height) + 1n !== BigInt(current.height) ||
        parent.timestamp > current.timestamp
      )
        return contradiction('invalid finalized ancestry')
      current = parent
    }
    return current
  }
  async readVerifiedSnapshot(): Promise<FinalizedSnapshot> {
    const heads = await Promise.all(
      this.sources.map(async (endpoint) => {
        const [chain, b] = await Promise.all([
          this.request(endpoint, 'eth_chainId', []),
          this.request(endpoint, 'eth_getBlockByNumber', ['finalized', false])
        ])
        if (quantity(chain) !== BigInt(this.config.chainId)) return contradiction('wrong chain')
        return parseBlock(b)
      })
    )
    const height =
      BigInt(heads[0].height) < BigInt(heads[1].height)
        ? BigInt(heads[0].height)
        : BigInt(heads[1].height)
    const blocks = await Promise.all(
      this.sources.map((endpoint, i) => this.ancestor(endpoint, heads[i], height))
    )
    if (stable(blocks[0]) !== stable(blocks[1]))
      return contradiction('common finalized block mismatch', {
        common: blocks,
        heads: heads.map((b) => ({ height: b.height, hash: b.hash }))
      })
    return {
      chainId: this.config.chainId,
      height: height.toString(),
      hash: blocks[0].hash,
      timestamp: blocks[0].timestamp,
      verifiedBy: this.sources,
      verifiedAt: new Date()
    }
  }

  async blockAt(height: string): Promise<VerifiedBlock> {
    const blocks = await Promise.all(
      this.sources.map(async (source) =>
        parseBlock(
          await this.request(source, 'eth_getBlockByNumber', [hexNumber(BigInt(height)), false])
        )
      )
    )
    if (blocks[0].height !== height || stable(blocks[0]) !== stable(blocks[1]))
      return contradiction('canonical block mismatch')
    return blocks[0]
  }
  async atHeight(height: string, head: FinalizedSnapshot): Promise<FinalizedSnapshot> {
    if (BigInt(height) > BigInt(head.height)) return unavailable('requested block not finalized')
    const b = await this.blockAt(height)
    const root = await this.blockAt(head.height)
    if (root.hash !== head.hash)
      return contradiction('finalized root changed during historical read')
    const ancestors = await Promise.all(
      this.sources.map((source) => this.historicalAncestor(source, root, BigInt(height)))
    )
    if (ancestors.some((a) => a.hash !== b.hash))
      return contradiction('historical block not on finalized ancestry')
    return { ...head, height: b.height, hash: b.hash, timestamp: b.timestamp }
  }
  async same(method: string, params: readonly unknown[]) {
    const values = await Promise.all(
      this.sources.map((source) => this.request(source, method, params))
    )
    if (stable(values[0]) !== stable(values[1]))
      return contradiction('historical source result mismatch: ' + method, {
        method,
        sourceResultSha256: values.map((v) => createHash('sha256').update(stable(v)).digest('hex'))
      })
    return values[0]
  }
  async call(
    name: string,
    args: readonly unknown[],
    at: FinalizedSnapshot,
    token = false
  ): Promise<unknown> {
    const abi: Abi = token ? erc20Abi : escrowAbi
    const data = encodeFunctionData({ abi, functionName: name, args })
    const result = await this.same('eth_call', [
      { to: token ? this.config.token : this.config.escrow, data },
      { blockHash: at.hash, requireCanonical: true }
    ])
    if (typeof result !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(result))
      return contradiction('invalid contract reply')
    try {
      return decodeFunctionResult({ abi, functionName: name, data: result as Hex })
    } catch {
      return contradiction('ABI reply mismatch')
    }
  }
  async verifyDeployment(at: FinalizedSnapshot) {
    if (BigInt(at.height) < BigInt(this.deployment.deploymentBlock))
      return unavailable('deployment not finalized')
    for (const [address, expected] of [
      [this.config.escrow, this.deployment.escrowCodeHash],
      [this.config.token, this.deployment.tokenCodeHash]
    ]) {
      const code = await this.same('eth_getCode', [
        address,
        { blockHash: at.hash, requireCanonical: true }
      ])
      if (
        typeof code !== 'string' ||
        code === '0x' ||
        !/^0x(?:[0-9a-f]{2})*$/i.test(code) ||
        keccak256(code as Hex) !== expected
      )
        return contradiction('deployment code mismatch')
    }
    const [token, admin, arbitrator, decimals] = await Promise.all([
      this.call('token', [], at),
      this.call('administrator', [], at),
      this.call('arbitrator', [], at),
      this.call('decimals', [], at, true)
    ])
    if (
      String(token).toLowerCase() !== this.config.token ||
      String(admin).toLowerCase() !== this.deployment.administrator ||
      String(arbitrator).toLowerCase() !== this.deployment.arbitrator ||
      Number(decimals) !== 6
    )
      return contradiction('deployment immutable terms mismatch')
  }
  async readOrder(id: Bytes32, at: FinalizedSnapshot): Promise<ObservedOrder> {
    const result = object(await this.call('orders', [id], at)),
      termsHash = hash32(await this.call('orderTermsHash', [id], at))
    const states = ['None', 'Funded', 'Delivered', 'Disputed', 'Released', 'Refunded'] as const
    const state = states[Number(result.state)]
    if (!state) return contradiction('unknown escrow state')
    return {
      orderId: id,
      state,
      buyer: String(result.buyer).toLowerCase() as EvmAddress,
      refundAddress: String(result.refundAddress).toLowerCase() as EvmAddress,
      seller: String(result.seller).toLowerCase() as EvmAddress,
      amountAtoms: String(result.amountAtoms),
      stockId: hash32(result.stockId),
      generation: String(result.generation),
      fundedAt: String(result.fundedAt),
      deliveredAt: String(result.deliveredAt),
      disputedAt: String(result.disputedAt),
      credentialId: hash32(result.credentialId),
      deliveryVersion: hash32(result.deliveryVersion),
      manifestCommitment: hash32(result.manifestCommitment),
      termsHash
    }
  }
  async readIntent(permit: PaymentPermit, at?: FinalizedSnapshot): Promise<VerifiedIntentState> {
    if (
      permit.chainId !== this.config.chainId ||
      permit.escrow !== this.config.escrow ||
      permit.token !== this.config.token
    )
      return contradiction('intent deployment mismatch')
    const snapshot = at ?? (await this.readVerifiedSnapshot())
    await this.verifyDeployment(snapshot)
    const [order, revoked, signer, occupant, generation] = await Promise.all([
      this.readOrder(permit.orderId, snapshot),
      this.call('revokedIntents', [permit.intentId], snapshot),
      this.call('signers', [0, permit.signerKeyId], snapshot),
      this.call('stockOccupant', [permit.stockId], snapshot),
      this.call('stockGeneration', [permit.stockId], snapshot)
    ])
    if (typeof revoked !== 'boolean' || !Array.isArray(signer) || typeof signer[3] !== 'boolean')
      return contradiction('intent flags malformed')
    const predecessor=order.state==='None' && permit.previousOrderId!=='0x'+'0'.repeat(64) && hash32(occupant)===permit.previousOrderId
      ? await this.readOrder(permit.previousOrderId,snapshot) : undefined
    return {
      snapshot,
      intentId: permit.intentId,
      orderId: permit.orderId,
      stockId: permit.stockId,
      orderState: order.state,
      intentRevoked: revoked,
      signerRevoked: signer[3],
      stockGeneration: String(generation),
      stockOccupant: hash32(occupant),
      ...(predecessor ? {predecessor} : {}),
      orderTermsHash: order.termsHash === '0x' + '0'.repeat(64) ? null : order.termsHash
    }
  }
  async scanAndVerify(from: string, tracked: readonly Bytes32[]): Promise<VerifiedRange> {
    const head = await this.readVerifiedSnapshot()
    if (!/^(0|[1-9][0-9]*)$/.test(from) || BigInt(from) > BigInt(head.height))
      return unavailable('no finalized scan range')
    const end =
      BigInt(from) + 127n < BigInt(head.height) ? BigInt(from) + 127n : BigInt(head.height)
    const at = await this.atHeight(end.toString(), head)
    await this.verifyDeployment(at)
    const blocks: VerifiedBlock[] = []
    for (let n = BigInt(from); n <= end; n++) {
      const b = await this.blockAt(n.toString()),
        previous = blocks.at(-1)
      if (previous && (b.parentHash !== previous.hash || b.timestamp < previous.timestamp))
        return contradiction('scan ancestry mismatch')
      blocks.push(b)
    }
    if (blocks.at(-1)?.hash !== at.hash) return contradiction('scan end mismatch')
    const raw = await this.same('eth_getLogs', [
      { address: this.config.escrow, fromBlock: hexNumber(BigInt(from)), toBlock: hexNumber(end) }
    ])
    if (!Array.isArray(raw) || raw.length > 4096) return unavailable('event budget')
    const events: VerifiedEvent[] = [],
      seen = new Set<string>(),
      receipts = new Map<string, Record<string, unknown>>()
    for (const item of raw) {
      const log = object(item),
        height = quantity(log.blockNumber).toString(),
        b = blocks.find((x) => x.height === height)
      if (
        !b ||
        hash32(log.blockHash) !== b.hash ||
        log.removed !== false ||
        String(log.address).toLowerCase() !== this.config.escrow
      )
        return contradiction('event canonical/address mismatch')
      const txHash = hash32(log.transactionHash),
        txIndex = quantity(log.transactionIndex).toString(),
        logIndex = quantity(log.logIndex).toString(),
        key = txHash + ':' + logIndex
      if (seen.has(key)) return contradiction('duplicate log in RPC range')
      seen.add(key)
      let receipt = receipts.get(txHash)
      if (!receipt) {
        receipt = object(await this.same('eth_getTransactionReceipt', [txHash]))
        receipts.set(txHash, receipt)
      }
      if (
        receipt.status !== '0x1' ||
        hash32(receipt.transactionHash) !== txHash ||
        hash32(receipt.blockHash) !== b.hash ||
        quantity(receipt.blockNumber).toString() !== height ||
        quantity(receipt.transactionIndex).toString() !== txIndex ||
        !Array.isArray(receipt.logs)
      )
        return contradiction('event receipt mismatch')
      const matching = receipt.logs.filter((v) => {
        const l = object(v)
        return l.logIndex === log.logIndex && String(l.address).toLowerCase() === this.config.escrow
      })
      if (matching.length !== 1 || stable(matching[0]) !== stable(log))
        return contradiction('receipt event mismatch')
      try {
        const decoded = decodeEventLog({
          abi: escrowAbi,
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
          strict: true
        })
        const args = JSON.parse(stable(decoded.args)) as Record<string, string | boolean>
        for (const key in args)
          if (typeof args[key] === 'string' && String(args[key]).startsWith('0x'))
            args[key] = String(args[key]).toLowerCase()
        if (args.timestamp !== undefined && String(args.timestamp) !== String(b.timestamp))
          return contradiction('event timestamp mismatch')
        events.push({
          name: decoded.eventName,
          args,
          height,
          blockHash: b.hash,
          txHash,
          txIndex,
          logIndex
        })
      } catch (e) {
        if (e instanceof ChainVerificationError) throw e
        return contradiction('unknown or malformed escrow event')
      }
    }
    for (const [tx, receipt] of receipts) {
      const count = (receipt.logs as unknown[]).filter(
        (v) => String(object(v).address).toLowerCase() === this.config.escrow
      ).length
      if (count !== events.filter((e) => e.txHash === tx).length)
        return contradiction('omitted receipt event')
    }
    events.sort((a, b) =>
      BigInt(a.height) < BigInt(b.height)
        ? -1
        : BigInt(a.height) > BigInt(b.height)
          ? 1
          : BigInt(a.txIndex) < BigInt(b.txIndex)
            ? -1
            : BigInt(a.txIndex) > BigInt(b.txIndex)
              ? 1
              : BigInt(a.logIndex) < BigInt(b.logIndex)
                ? -1
                : 1
    )
    const ids = new Set<Bytes32>(tracked)
    for (const e of events) if (e.args.orderId) ids.add(hash32(e.args.orderId))
    const orders: ObservedOrder[] = []
    const pending = [...ids]
    // Bound concurrent I/O, not the cumulative number of retained historical orders.
    for (let offset = 0; offset < pending.length; offset += 8)
      orders.push(
        ...(await Promise.all(
          pending.slice(offset, offset + 8).map((id) => this.readOrder(id, at))
        ))
      )
    const stockIds = [...new Set(orders.filter((o) => o.state !== 'None').map((o) => o.stockId))],
      stocks = []
    for (const id of stockIds)
      stocks.push({
        stockId: id,
        occupant: hash32(await this.call('stockOccupant', [id], at)),
        generation: String(await this.call('stockGeneration', [id], at))
      })
    const [outstanding, totalDeposited, totalPaid, balance, paused] = await Promise.all([
      this.call('outstanding', [], at),
      this.call('totalDeposited', [], at),
      this.call('totalPaid', [], at),
      this.call('balanceOf', [this.config.escrow], at, true),
      this.call('depositPaused', [], at)
    ])
    return {
      from,
      snapshot: at,
      blocks,
      events,
      orders,
      stocks,
      globals: {
        outstanding: String(outstanding),
        totalDeposited: String(totalDeposited),
        totalPaid: String(totalPaid),
        balance: String(balance),
        paused: Boolean(paused)
      }
    }
  }

  async observeTransaction(
    txHash: Bytes32,
    previous?: AttemptObservation
  ): Promise<AttemptObservation> {
    try {
      const [tx, r] = await Promise.all([
        this.same('eth_getTransactionByHash', [txHash]),
        this.same('eth_getTransactionReceipt', [txHash])
      ])
      let orphanedBlockHash: string | undefined
      if (!r && previous?.blockHash && previous.height) {
        const canonical = await this.blockAt(previous.height)
        if (canonical.hash !== previous.blockHash) orphanedBlockHash = previous.blockHash
      }
      if (!tx) return { status: 'unknown', orphanedBlockHash, businessConfirmation: false }
      const transaction = object(tx),
        sender = String(transaction.from).toLowerCase(),
        nonce = quantity(transaction.nonce).toString()
      if (hash32(transaction.hash) !== txHash || !/^0x[0-9a-f]{40}$/.test(sender))
        return { status: 'unknown', businessConfirmation: false }
      if (!r)
        return { status: 'unknown', sender, nonce, orphanedBlockHash, businessConfirmation: false }
      const receipt = object(r),
        height = quantity(receipt.blockNumber).toString(),
        blockHash = hash32(receipt.blockHash)
      if (
        hash32(receipt.transactionHash) !== txHash ||
        !['0x0', '0x1'].includes(String(receipt.status))
      )
        return { status: 'unknown', sender, nonce, businessConfirmation: false }
      const block = await this.blockAt(height)
      if (block.hash !== blockHash)
        return { status: 'unknown', sender, nonce, businessConfirmation: false }
      const head = await this.readVerifiedSnapshot(),
        finalized = BigInt(height) <= BigInt(head.height)
      if (finalized && (await this.atHeight(height, head)).hash !== blockHash)
        return { status: 'unknown', sender, nonce, businessConfirmation: false }
      return {
        status: finalized ? 'finalized' : receipt.status === '0x0' ? 'reverted' : 'included',
        sender,
        nonce,
        height,
        blockHash,
        transactionSucceeded: receipt.status === '0x1',
        businessConfirmation: false
      }
    } catch (e) {
      if (e instanceof ChainVerificationError)
        return { status: 'unknown', businessConfirmation: false }
      throw e
    }
  }
}
