import { createHash } from 'node:crypto'
import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { transact, type Transaction, type TransactionOptions } from '../database/transaction.js'
import {
  contradiction,
  ChainVerificationError,
  stable,
  type ChainDeployment
} from './chain-observer.js'
import type { ObservedOrder, VerifiedEvent, VerifiedRange } from './escrow-state.js'
import type { Bytes32, Web3Config } from './web3-types.js'
const zero = ('0x' + '0'.repeat(64)) as Bytes32
const json = (v: unknown) => JSON.parse(stable(v)) as Prisma.InputJsonValue
export const chainScope = (c: Pick<Web3Config, 'chainId' | 'escrow'>) => c.chainId + ':' + c.escrow
export function deploymentDigest(
  config: Pick<Web3Config, 'chainId' | 'escrow' | 'token' | 'rpcPrimary' | 'rpcSecondary'>,
  deployment: ChainDeployment
) {
  return createHash('sha256')
    .update(
      stable({
        chainId: config.chainId,
        escrow: config.escrow,
        token: config.token,
        primary: config.rpcPrimary,
        secondary: config.rpcSecondary,
        deployment
      })
    )
    .digest('hex')
}
export async function lockChain(tx: Transaction, scope: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${scope}, 7))`
}
function reduce(orders: Map<string, ObservedOrder>, e: VerifiedEvent, token: string) {
  const a = e.args,
    id = String(a.orderId),
    time = BigInt(String(a.timestamp ?? '0')),
    o = orders.get(id)
  const need = (ok: unknown) => {
    if (!ok) contradiction('invalid ' + e.name + ' transition')
  }
  if (e.name === 'Deposited') {
    need(
      !o &&
        a.token === token &&
        a.buyer === a.refundAddress &&
        BigInt(String(a.amountAtoms)) > 0n &&
        BigInt(String(a.deliveryDeadline)) === time + 259200n
    )
    orders.set(id, {
      orderId: id as Bytes32,
      state: 'Funded',
      buyer: String(a.buyer) as ObservedOrder['buyer'],
      refundAddress: String(a.refundAddress) as ObservedOrder['buyer'],
      seller: String(a.seller) as ObservedOrder['buyer'],
      amountAtoms: String(a.amountAtoms),
      stockId: String(a.stockId) as Bytes32,
      generation: String(a.generation),
      fundedAt: String(time),
      deliveredAt: '0',
      disputedAt: '0',
      credentialId: zero,
      deliveryVersion: zero,
      manifestCommitment: zero,
      termsHash: String(a.termsHash) as Bytes32
    })
    return
  }
  if (['DeliveryRegistered', 'DisputeOpened', 'Released', 'Refunded'].includes(e.name)) {
    need(o)
    if (!o) return
    if (e.name === 'DeliveryRegistered') {
      need(
        o.state === 'Funded' &&
          a.seller === o.seller &&
          time < BigInt(o.fundedAt) + 259200n &&
          time >= BigInt(o.fundedAt) &&
          a.credentialId !== zero &&
          a.deliveryVersion !== zero &&
          BigInt(String(a.acceptanceDeadline)) === time + 604800n
      )
      Object.assign(o, {
        state: 'Delivered',
        deliveredAt: String(time),
        credentialId: a.credentialId,
        deliveryVersion: a.deliveryVersion,
        manifestCommitment: a.manifestCommitment
      })
    } else if (e.name === 'DisputeOpened') {
      need(
        o.state === 'Delivered' &&
          a.buyer === o.buyer &&
          time >= BigInt(o.deliveredAt) &&
          time < BigInt(o.deliveredAt) + 604800n &&
          BigInt(String(a.disputeDeadline)) === time + 604800n
      )
      Object.assign(o, { state: 'Disputed', disputedAt: String(time) })
    } else {
      const refund = e.name === 'Refunded',
        reason = String(a.reason)
      need(
        a.token === token &&
          String(a.amountAtoms) === o.amountAtoms &&
          a.recipient === (refund ? o.refundAddress : o.seller)
      )
      const deliveryEnd = BigInt(o.deliveredAt) + 604800n,
        disputeEnd = BigInt(o.disputedAt) + 604800n
      need(
        refund
          ? (o.state === 'Funded' && reason === '2' && time >= BigInt(o.fundedAt) + 259200n) ||
              (o.state === 'Disputed' &&
                time >= BigInt(o.disputedAt) &&
                ((reason === '4' && time < disputeEnd) || (reason === '5' && time >= disputeEnd)))
          : (o.state === 'Delivered' &&
              time >= BigInt(o.deliveredAt) &&
              ((reason === '0' && time < deliveryEnd) ||
                (reason === '1' && time >= deliveryEnd))) ||
              (o.state === 'Disputed' &&
                reason === '3' &&
                time >= BigInt(o.disputedAt) &&
                time < disputeEnd)
      )
      o.state = refund ? 'Refunded' : 'Released'
    }
  }
}
function fingerprint(r: VerifiedRange) {
  const digest = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex')
  return {
    ordersHash: digest(
      r.orders
        .filter((o) => o.state !== 'None')
        .slice()
        .sort((a, b) => a.orderId.localeCompare(b.orderId))
    ),
    stocksHash: digest(r.stocks.slice().sort((a, b) => a.stockId.localeCompare(b.stockId)))
  }
}
export class EscrowProjector {
  readonly scope: string
  readonly configHash: string
  constructor(
    readonly client: PrismaClient,
    readonly config: Pick<
      Web3Config,
      'chainId' | 'token' | 'escrow' | 'rpcPrimary' | 'rpcSecondary'
    >,
    readonly deployment: ChainDeployment,
    readonly verifyResolutions?: (range: VerifiedRange) => Promise<() => Promise<void>>
  ) {
    this.scope = chainScope(config)
    this.configHash = deploymentDigest(config, deployment)
  }
  async initialize(mode: 'fresh' | 'recovery') {
    // Owner-run provisioning only. Never auto-create an active checkpoint in API/indexer.
    return transact(this.client, async (tx) => {
      await lockChain(tx, this.scope)
      const old = await tx.scanCheckpoint.findUnique({ where: { scope: this.scope } })
      if (old) throw new Error('Checkpoint already exists; initialization cannot reset recovery')
      if (mode === 'fresh' && (await tx.paymentOrderTerms.count()))
        throw new Error('Existing private history requires recovery isolation')
      return tx.scanCheckpoint.create({
        data: {
          scope: this.scope,
          configHash: this.configHash,
          deploymentBlock: BigInt(this.deployment.deploymentBlock),
          height: BigInt(this.deployment.deploymentBlock) - 1n,
          hash: zero,
          status: mode === 'fresh' ? 'active' : 'recovering'
        }
      })
    })
  }
  async isolate(reason: string, evidence: unknown = {}) {
    await transact(this.client, async (tx) => {
      await lockChain(tx, this.scope)
      const checkpoint = await tx.scanCheckpoint.findUnique({ where: { scope: this.scope } })
      await tx.reconciliationIncident.create({
        data: {
          scope: this.scope,
          kind: 'finalized_contradiction',
          reason,
          evidence: json(evidence)
        }
      })
      if (checkpoint)
        await tx.scanCheckpoint.update({
          where: { scope: this.scope },
          data: { status: 'isolated' }
        })
      const terms = await tx.paymentOrderTerms.findMany({
        select: { listingId: true, terms: true }
      })
      for (const t of terms) {
        const v = t.terms as { chainId: number; escrow: string }
        if (v.chainId === this.config.chainId && v.escrow === this.config.escrow)
          await tx.testnetStock.updateMany({
            where: { listingId: t.listingId },
            data: { state: 'protected' }
          })
      }
    })
  }
  async project(r: VerifiedRange, options: TransactionOptions = {}) {
    try {
      const historyGuard = await this.verifyResolutions?.(r)
      return await transact(
        this.client,
        async (tx, attempt) => {
          await lockChain(tx, this.scope)
          await historyGuard?.()
          const cursor = await tx.scanCheckpoint.findUnique({ where: { scope: this.scope } })
          if (!cursor || cursor.configHash !== this.configHash || cursor.status === 'isolated')
            throw new ChainVerificationError(
              'unavailable',
              'checkpoint missing, isolated or wrong deployment'
            )
          if (
            r.snapshot.chainId !== this.config.chainId ||
            stable(r.snapshot.verifiedBy) !==
              stable([this.config.rpcPrimary, this.config.rpcSecondary]) ||
            BigInt(r.from) < cursor.deploymentBlock ||
            BigInt(r.from) > cursor.height + 1n ||
            !r.blocks.length ||
            r.blocks[0].height !== r.from ||
            r.blocks.at(-1)?.height !== r.snapshot.height ||
            r.blocks.at(-1)?.hash !== r.snapshot.hash
          )
            contradiction('projection range mismatch')
          for (let i = 0; i < r.blocks.length; i++) {
            const b = r.blocks[i],
              prev = r.blocks[i - 1]
            if (
              prev &&
              (BigInt(b.height) !== BigInt(prev.height) + 1n || b.parentHash !== prev.hash)
            )
              contradiction('projection ancestry mismatch')
            const old = await tx.chainBlock.findUnique({
              where: { scope_height: { scope: this.scope, height: BigInt(b.height) } }
            })
            if (
              old &&
              (old.hash !== b.hash ||
                old.parentHash !== b.parentHash ||
                old.timestamp !== BigInt(b.timestamp))
            )
              contradiction('accepted finalized block changed')
          }
          if (
            BigInt(r.from) === cursor.height + 1n &&
            cursor.height >= cursor.deploymentBlock &&
            r.blocks[0].parentHash !== cursor.hash
          )
            contradiction('cursor ancestry changed')
          if (BigInt(r.from) <= cursor.height) {
            const to =
              BigInt(r.snapshot.height) < cursor.height ? BigInt(r.snapshot.height) : cursor.height
            const accepted = await tx.chainEvent.findMany({
              where: { scope: this.scope, height: { gte: BigInt(r.from), lte: to } },
              orderBy: [{ height: 'asc' }, { txIndex: 'asc' }, { logIndex: 'asc' }]
            })
            const returned = r.events.filter((e) => BigInt(e.height) <= to)
            const normalize = (e: (typeof accepted)[number]) => ({
              name: e.name,
              args: e.args,
              height: e.height.toString(),
              blockHash: e.blockHash,
              txHash: e.txHash,
              txIndex: e.txIndex.toString(),
              logIndex: e.logIndex.toString()
            })
            if (stable(accepted.map(normalize)) !== stable(returned))
              contradiction('accepted finalized event set changed or incomplete')
          }
          if (BigInt(r.snapshot.height) <= cursor.height) {
            const accepted = await tx.chainSnapshot.findUnique({
              where: { scope_height: { scope: this.scope, height: BigInt(r.snapshot.height) } }
            })
            if (!accepted)
              throw new ChainVerificationError(
                'unavailable',
                'historical H projection manifest not recorded'
              )
            const f = fingerprint(r)
            if (
              accepted.hash !== r.snapshot.hash ||
              accepted.ordersHash !== f.ordersHash ||
              accepted.stocksHash !== f.stocksHash ||
              stable(accepted.globals) !== stable(r.globals)
            )
              contradiction('accepted finalized complete snapshot changed')
            return { status: 'unchanged', height: cursor.height.toString() }
          }
          const saved = await tx.escrowProjection.findMany({ where: { scope: this.scope } }),
            orders = new Map(saved.map((o) => [o.chainOrderId, o.data as unknown as ObservedOrder]))
          const events = r.events.filter((e) => BigInt(e.height) > cursor.height)
          let previous = ''
          for (const e of events) {
            const b = r.blocks.find((b) => b.height === e.height)
            if (!b || b.hash !== e.blockHash) contradiction('event outside verified range')
            const position = [e.height, e.txIndex, e.logIndex]
              .map((n) => n.padStart(80, '0'))
              .join(':')
            if (position <= previous) contradiction('unordered or duplicate event')
            previous = position
            reduce(orders, e, this.config.token)
          }
          const observed = new Map<string, ObservedOrder>(
            r.orders.filter((o) => o.state !== 'None').map((o) => [o.orderId, o])
          )
          if (observed.size !== orders.size) contradiction('incomplete historical order state set')
          for (const [id, o] of orders)
            if (stable(o) !== stable(observed.get(id)))
              contradiction('complete order projection differs from H state')
          let deposited = 0n,
            paid = 0n,
            outstanding = 0n
          for (const o of orders.values()) {
            deposited += BigInt(o.amountAtoms)
            if (['Released', 'Refunded'].includes(o.state)) paid += BigInt(o.amountAtoms)
            else outstanding += BigInt(o.amountAtoms)
          }
          if (
            deposited.toString() !== r.globals.totalDeposited ||
            paid.toString() !== r.globals.totalPaid ||
            outstanding.toString() !== r.globals.outstanding ||
            BigInt(r.globals.balance) < outstanding
          )
            contradiction('escrow funding reconciliation mismatch')
          await options.checkpoint?.('before-projection', tx, attempt)
          let missing = false
          for (const o of orders.values()) {
            const terms = await tx.paymentOrderTerms.findMany({ where: { stockId: o.stockId } })
            const basis = terms.find((t) => (t.terms as { orderId: string }).orderId === o.orderId)
            if (basis) {
              const t = basis.terms as {
                buyer: string
                refundAddress: string
                seller: string
                token: string
                amountAtoms: string
                chainId: number
                escrow: string
                stockGeneration: string
              }
              if (
                basis.termsHash !== o.termsHash ||
                t.buyer !== o.buyer ||
                t.refundAddress !== o.refundAddress ||
                t.seller !== o.seller ||
                t.token !== this.config.token ||
                t.amountAtoms !== o.amountAtoms ||
                t.chainId !== this.config.chainId ||
                t.escrow !== this.config.escrow ||
                t.stockGeneration !== o.generation
              )
                contradiction('private fixed terms disagree with chain')
            } else missing = true
            await tx.escrowProjection.upsert({
              where: { scope_chainOrderId: { scope: this.scope, chainOrderId: o.orderId } },
              create: {
                scope: this.scope,
                chainOrderId: o.orderId,
                businessOrderId: basis?.orderId ?? null,
                state: o.state,
                stockId: o.stockId,
                amountAtoms: o.amountAtoms,
                data: json(o),
                height: BigInt(r.snapshot.height),
                blockHash: r.snapshot.hash,
                holdReason: basis ? null : 'PRIVATE_BASIS_MISSING',
                downloadEnabled: false
              },
              update: {
                state: o.state,
                data: json(o),
                height: BigInt(r.snapshot.height),
                blockHash: r.snapshot.hash,
                holdReason: basis ? null : 'PRIVATE_BASIS_MISSING',
                downloadEnabled: false
              }
            })
            if (basis) {
              await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id"=${basis.listingId}::uuid FOR UPDATE`
              await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${basis.orderId}::uuid FOR UPDATE`
              const row = await tx.order.findUniqueOrThrow({ where: { id: basis.orderId } })
              if (row.settlementMode !== 'testnet_escrow')
                contradiction('business settlement mode mismatch')
              const status = {
                Funded: 'pending_delivery',
                Delivered: 'pending_acceptance',
                Disputed: 'issue',
                Released: 'completed',
                Refunded: 'refunded'
              }[o.state as Exclude<ObservedOrder['state'], 'None'>]
              if (row.status !== status)
                await tx.order.update({
                  where: { id: row.id },
                  data: {
                    status,
                    version: { increment: 1 },
                    completedAt: ['Released', 'Refunded'].includes(o.state)
                      ? r.snapshot.verifiedAt
                      : null
                  }
                })
              // T07 never guesses private issuance validity to release/re-sign stock. T08 owns safe refund generation activation.
              await tx.testnetStock.updateMany({
                where: { stockId: o.stockId, activeOrderId: basis.orderId },
                data: { state: 'protected' }
              })
              await tx.paymentIntentState.updateMany({
                where: {
                  orderId: basis.orderId,
                  status: { in: ['issued', 'cancellation_pending', 'reconciling'] }
                },
                data: {
                  status: 'funded',
                  verification: json({ snapshot: r.snapshot, orderState: o.state })
                }
              })
            }
          }
          for (const stock of r.stocks) {
            const o = orders.get(stock.occupant)
            if (!o || o.stockId !== stock.stockId || o.generation !== stock.generation)
              contradiction('stock at H differs from orders')
            const status =
              o.state === 'Released'
                ? 'sold'
                : o.state === 'Refunded'
                  ? o.credentialId === zero
                    ? 'refundable_unregistered'
                    : 'blocked_registered'
                  : 'occupied'
            await tx.chainStockProjection.upsert({
              where: { scope_stockId: { scope: this.scope, stockId: stock.stockId } },
              create: {
                scope: this.scope,
                ...stock,
                status,
                height: BigInt(r.snapshot.height),
                blockHash: r.snapshot.hash
              },
              update: {
                ...stock,
                status,
                height: BigInt(r.snapshot.height),
                blockHash: r.snapshot.hash
              }
            })
          }
          if (r.stocks.length !== new Set([...orders.values()].map((o) => o.stockId)).size)
            contradiction('incomplete stock set')
          for (const b of r.blocks)
            if (BigInt(b.height) > cursor.height)
              await tx.chainBlock.create({
                data: {
                  scope: this.scope,
                  hash: b.hash,
                  height: BigInt(b.height),
                  parentHash: b.parentHash,
                  timestamp: BigInt(b.timestamp)
                }
              })
          for (const e of events) {
            await tx.chainEvent.create({
              data: {
                scope: this.scope,
                blockHash: e.blockHash,
                txHash: e.txHash,
                logIndex: BigInt(e.logIndex),
                height: BigInt(e.height),
                txIndex: BigInt(e.txIndex),
                name: e.name,
                args: json(e.args)
              }
            })
            await tx.transactionAttempt.updateMany({
              where: { scope: this.scope, txHash: e.txHash },
              data: {
                status: 'finalized',
                observation: json({
                  snapshot: r.snapshot,
                  event: e.name,
                  businessConfirmation: false
                })
              }
            })
          }
          await tx.chainSnapshot.create({
            data: {
              scope: this.scope,
              height: BigInt(r.snapshot.height),
              hash: r.snapshot.hash,
              ...fingerprint(r),
              globals: json(r.globals)
            }
          })
          await tx.scanCheckpoint.update({
            where: { scope: this.scope },
            data: {
              height: BigInt(r.snapshot.height),
              hash: r.snapshot.hash,
              globals: json(r.globals),
              status: missing ? 'recovering' : cursor.status
            }
          })
          await options.checkpoint?.('before-commit', tx, attempt)
          return {
            status: missing ? 'recovering' : cursor.status,
            height: r.snapshot.height,
            events: events.length,
            orders: orders.size
          }
        },
        options
      )
    } catch (e) {
      if (e instanceof ChainVerificationError && e.kind === 'contradiction')
        await this.isolate(e.reason, {
          range: { from: r.from, height: r.snapshot.height, hash: r.snapshot.hash },
          observed: e.evidence ?? null
        })
      throw e
    }
  }
}
