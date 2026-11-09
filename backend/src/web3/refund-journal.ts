import { createHash } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Transaction, TransactionOptions } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { stable, contradiction, ChainVerificationError } from './chain-observer.js'
import type { IssuanceRecord } from './payment-journal.js'
import type { ObservedOrder, VerifiedEvent } from './escrow-state.js'
import type { FinalizedSnapshot } from './web3-types.js'
const zero = '0x' + '0'.repeat(64)
export interface RefundEvidence {
  schemaVersion: 1
  record: IssuanceRecord
  snapshot: FinalizedSnapshot
  deploymentHash: string
  order: ObservedOrder
  stock: { stockId: string; occupant: string; generation: string }
  deposit: VerifiedEvent
  refund: VerifiedEvent
}
export interface RefundExit {
  scope: string
  chainId: number
  escrow: string
  chainOrderId: string
  orderId: string
  listingId: string
  stockId: string
  generation: string
  nextGeneration: string
  fundedIntentId: string
  recoveryEpoch: string
  basisHash: string
  evidence: RefundEvidence
  refundHeight: bigint
  refundBlockHash: string
  refundTxHash: string
  refundLogIndex: bigint
  finalizedHeight: bigint
  finalizedHash: string
  neverRegistered: boolean
  createdAt: Date
}
const hash = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex')
export function validateRefundEvidence(e: RefundEvidence) {
  try {
    const r = e.record,
      p = r.permit,
      o = e.order,
      d = e.deposit,
      f = e.refund
    if (
      e.schemaVersion !== 1 ||
      e.snapshot.chainId !== p.chainId ||
      r.scope !== p.chainId + ':' + p.escrow ||
      r.stockId !== p.stockId ||
      o.orderId !== p.orderId ||
      o.state !== 'Refunded' ||
      o.stockId !== p.stockId ||
      o.generation !== p.stockGeneration ||
      o.buyer !== p.buyer ||
      o.refundAddress !== p.refundAddress ||
      o.seller !== p.seller ||
      o.amountAtoms !== p.amountAtoms ||
      o.termsHash !== r.termsHash ||
      o.credentialId !== zero ||
      o.deliveryVersion !== zero ||
      o.manifestCommitment !== zero ||
      o.deliveredAt !== '0' ||
      o.disputedAt !== '0' ||
      e.stock.stockId !== p.stockId ||
      e.stock.occupant !== p.orderId ||
      e.stock.generation !== p.stockGeneration ||
      d.name !== 'Deposited' ||
      d.args.orderId !== p.orderId ||
      d.args.intentId !== p.intentId ||
      d.args.stockId !== p.stockId ||
      d.args.generation !== p.stockGeneration ||
      d.args.termsHash !== r.termsHash ||
      d.args.token !== p.token ||
      d.args.amountAtoms !== p.amountAtoms ||
      d.args.buyer !== p.buyer ||
      d.args.seller !== p.seller ||
      d.args.refundAddress !== p.refundAddress ||
      d.args.timestamp !== o.fundedAt ||
      f.name !== 'Refunded' ||
      f.args.orderId !== p.orderId ||
      f.args.token !== p.token ||
      f.args.recipient !== p.refundAddress ||
      f.args.amountAtoms !== p.amountAtoms ||
      String(f.args.reason) !== '2' ||
      BigInt(f.args.timestamp) < BigInt(o.fundedAt) + 259200n ||
      BigInt(f.height) > BigInt(e.snapshot.height) ||
      BigInt(d.height) > BigInt(f.height) ||
      BigInt(p.stockGeneration) >= (1n << 256n) - 1n ||
      !/^[0-9a-f]{64}$/.test(e.deploymentHash)
    )
      throw new Error('proof')
  } catch {
    throw new DomainError('WALLET_UNAVAILABLE')
  }
}
export function validateRefundExit(row: RefundExit) {
  validateRefundEvidence(row.evidence)
  const e = row.evidence,
    r = e.record,
    p = r.permit,
    f = e.refund
  if (
    row.basisHash !== hash(e) ||
    row.scope !== r.scope ||
    row.chainId !== p.chainId ||
    row.escrow !== p.escrow ||
    row.chainOrderId !== p.orderId ||
    row.orderId !== r.orderId ||
    row.listingId !== r.listingId ||
    row.stockId !== r.stockId ||
    row.generation !== p.stockGeneration ||
    row.nextGeneration !== (BigInt(p.stockGeneration) + 1n).toString() ||
    row.fundedIntentId !== r.id ||
    row.recoveryEpoch !== r.recoveryEpoch ||
    row.refundHeight !== BigInt(f.height) ||
    row.refundBlockHash !== f.blockHash ||
    row.refundTxHash !== f.txHash ||
    row.refundLogIndex !== BigInt(f.logIndex) ||
    row.finalizedHeight !== BigInt(e.snapshot.height) ||
    row.finalizedHash !== e.snapshot.hash ||
    row.neverRegistered !== true
  )
    throw new DomainError('WALLET_UNAVAILABLE')
  return row
}
export class RefundJournal {
  constructor(
    readonly client: PrismaClient,
    readonly ledgerId: string
  ) {}
  private async transaction<T>(work: (tx: Transaction) => Promise<T>) {
    try {
      return await this.client.$transaction(
        async (tx) => {
          const [m] = await tx.$queryRaw<
            { ledgerId: string; recoveryEpoch: string; maintenance: boolean; writable: boolean }[]
          >`SELECT *,NOT pg_is_in_recovery() AND current_setting('transaction_read_only')='off' AS writable FROM "WalletLedgerMeta" WHERE "singleton"=true`
          if (!m || m.ledgerId !== this.ledgerId || m.maintenance || !m.writable)
            throw new DomainError('WALLET_UNAVAILABLE')
          return work(tx)
        },
        { timeout: 10000 }
      )
    } catch (e) {
      if (e instanceof DomainError || e instanceof ChainVerificationError) throw e
      throw new DomainError('WALLET_UNAVAILABLE')
    }
  }
  async find(scope: string, chainOrderId: string) {
    return this.transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        RefundExit[]
      >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${scope} AND "chainOrderId"=${chainOrderId}`
      return row ? validateRefundExit(row) : null
    })
  }
  async record(e: RefundEvidence, options: TransactionOptions = {}) {
    validateRefundEvidence(e)
    const r = e.record,
      p = r.permit,
      f = e.refund
    const result = await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${r.scope + ':' + r.listingId},0))`
      const [meta] = await tx.$queryRaw<
        { recoveryEpoch: string }[]
      >`SELECT "recoveryEpoch" FROM "WalletLedgerMeta" WHERE "singleton"=true`
      const [old] = await tx.$queryRaw<
        RefundExit[]
      >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${r.scope} AND "chainOrderId"=${p.orderId}`
      if (old) {
        validateRefundExit(old)
        const a = old.evidence
        if (
          stable(a.record) !== stable(r) ||
          stable(a.order) !== stable(e.order) ||
          stable(a.deposit) !== stable(e.deposit) ||
          stable(a.refund) !== stable(e.refund) ||
          a.deploymentHash !== e.deploymentHash
        )
          contradiction('independent refund exit conflicts')
        return old
      }
      const [head] = await tx.$queryRaw<
        { intentId: string; stockId: string }[]
      >`SELECT * FROM "PaymentLedgerHead" WHERE "scope"=${r.scope} AND "listingId"=${r.listingId}::uuid`
      const [issued] = await tx.$queryRaw<
        IssuanceRecord[]
      >`SELECT "id","orderId","listingId","stockId","scope","digest","termsHash","recoveryEpoch","permit","previousIntentId" FROM "PaymentLedgerIntent" WHERE "id"=${r.id}::uuid`
      const [ended] = await tx.$queryRaw<
        { outcome: string }[]
      >`SELECT "outcome" FROM "PaymentLedgerResolution" WHERE "intentId"=${r.id}::uuid`
      if (ended?.outcome === 'invalid') contradiction('refund contradicts independent invalidity')
      if (
        !issued ||
        stable(issued) !== stable(r) ||
        head?.intentId !== r.id ||
        head.stockId !== r.stockId ||
        meta.recoveryEpoch !== r.recoveryEpoch
      )
        throw new DomainError('WALLET_UNAVAILABLE')
      await options.checkpoint?.('before-refund-ledger-write', tx, 1)
      const evidence = stable(e),
        basisHash = hash(e),
        next = (BigInt(p.stockGeneration) + 1n).toString()
      await tx.$executeRaw`INSERT INTO "PaymentLedgerRefundExit" ("scope","chainId","escrow","chainOrderId","orderId","listingId","stockId","generation","nextGeneration","fundedIntentId","recoveryEpoch","basisHash","evidence","refundHeight","refundBlockHash","refundTxHash","refundLogIndex","finalizedHeight","finalizedHash","neverRegistered") VALUES (${r.scope},${p.chainId},${p.escrow},${p.orderId},${r.orderId}::uuid,${r.listingId}::uuid,${r.stockId},${p.stockGeneration},${next},${r.id}::uuid,${r.recoveryEpoch}::uuid,${basisHash},${evidence}::jsonb,${BigInt(f.height)},${f.blockHash},${f.txHash},${BigInt(f.logIndex)},${BigInt(e.snapshot.height)},${e.snapshot.hash},true)`
      await options.checkpoint?.('before-refund-ledger-commit', tx, 1)
      const [row] = await tx.$queryRaw<
        RefundExit[]
      >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${r.scope} AND "chainOrderId"=${p.orderId}`
      return validateRefundExit(row)
    })
    await options.checkpoint?.('after-refund-ledger-commit', this.client, 1)
    return result
  }
  // Caller already holds business chain/listing locks. All issuer paths take
  // business locks before independent head locks; never hold these in reverse.
  async withHead<T>(exit: RefundExit, work: (current: RefundExit) => Promise<T>) {
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${exit.scope + ':' + exit.listingId},0))`
      const [row] = await tx.$queryRaw<
        RefundExit[]
      >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${exit.scope} AND "chainOrderId"=${exit.chainOrderId}`
      if (!row || validateRefundExit(row).basisHash !== exit.basisHash)
        throw new DomainError('WALLET_UNAVAILABLE')
      const [head] = await tx.$queryRaw<
        { intentId: string; stockId: string }[]
      >`SELECT * FROM "PaymentLedgerHead" WHERE "scope"=${exit.scope} AND "listingId"=${exit.listingId}::uuid`
      if (head?.intentId !== exit.fundedIntentId || head.stockId !== exit.stockId)
        return { status: 'superseded' } as const
      return work(row)
    })
  }
}
