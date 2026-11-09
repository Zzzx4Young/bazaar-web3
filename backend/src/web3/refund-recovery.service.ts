import type { PrismaClient } from '../generated/prisma/client.js'
import { transact, type TransactionOptions } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import {
  ChainVerificationError,
  contradiction,
  unavailable,
  stable,
  type DualChainObserver
} from './chain-observer.js'
import { chainScope, deploymentDigest, lockChain, EscrowProjector } from './escrow-projector.js'
import {
  RefundJournal,
  validateRefundEvidence,
  validateRefundExit,
  type RefundEvidence,
  type RefundExit
} from './refund-journal.js'
import type { PostgresPaymentJournal, IssuanceRecord } from './payment-journal.js'
import type { VerifiedEvent } from './escrow-state.js'
import type { PaymentPermit, Bytes32 } from './web3-types.js'
const zero = '0x' + '0'.repeat(64)
export class RefundRecoveryService {
  readonly scope: string
  constructor(
    readonly client: PrismaClient,
    readonly observer: DualChainObserver,
    readonly payments: PostgresPaymentJournal,
    readonly exits: RefundJournal
  ) {
    this.scope = chainScope(observer.config)
  }
  async runOnce(options: TransactionOptions = {}) {
    const candidates = await this.client.escrowProjection.findMany({
      where: {
        scope: this.scope,
        state: 'Refunded',
        holdReason: null,
        businessOrderId: { not: null }
      },
      orderBy: { chainOrderId: 'asc' }
    })
    let applied = 0
    for (const c of candidates) {
      const o = c.data as { credentialId: string }
      if (o.credentialId !== zero) continue
      const t = await this.client.paymentOrderTerms.findUnique({
        where: { orderId: c.businessOrderId! }
      })
      if (!t) return unavailable('refund private mapping missing')
      const stock = await this.client.testnetStock.findUnique({ where: { listingId: t.listingId } })
      if (!stock) return unavailable('refund inventory missing')
      const receipt = await this.client.refundInventoryTransition.findUnique({
        where: { scope_chainOrderId: { scope: this.scope, chainOrderId: c.chainOrderId } }
      })
      // Completed/successor inventory never consumes an old exit a second time.
      if (stock.activeOrderId && stock.activeOrderId !== t.orderId) continue
      if (
        BigInt(stock.generation) >
          BigInt((t.terms as { stockGeneration: string }).stockGeneration) &&
        (BigInt(stock.generation) >
          BigInt((t.terms as { stockGeneration: string }).stockGeneration) + 1n ||
          (stock.state === 'free' && receipt))
      )
        continue
      try {
        await this.payments.assertBusinessBasis(this.client, this.scope)
        const exit = await this.prepare(t.orderId, c.chainOrderId as Bytes32, options)
        const result = await this.apply(exit, options)
        if (result.status === 'applied') applied++
      } catch (e) {
        await transact(this.client, async (tx) => {
          await lockChain(tx, this.scope)
          await tx.testnetStock.updateMany({
            where: {
              listingId: t.listingId,
              OR: [{ activeOrderId: t.orderId }, { activeOrderId: null, lastOrderId: t.orderId }]
            },
            data: { state: 'protected' }
          })
        })
        if (e instanceof ChainVerificationError && e.kind === 'contradiction')
          await new EscrowProjector(
            this.client,
            this.observer.config,
            this.observer.deployment
          ).isolate(e.reason, e.evidence ?? {})
        throw e
      }
    }
    return { applied }
  }
  private async prepare(orderId: string, chainOrderId: Bytes32, options: TransactionOptions) {
    const head = await this.observer.readVerifiedSnapshot()
    await this.observer.verifyDeployment(head)
    const cursor = await this.client.scanCheckpoint.findUnique({ where: { scope: this.scope } })
    if (
      !cursor ||
      cursor.status !== 'active' ||
      cursor.configHash !== deploymentDigest(this.observer.config, this.observer.deployment) ||
      cursor.height.toString() !== head.height ||
      cursor.hash !== head.hash
    )
      return unavailable('refund complete common H pending')
    const manifest = await this.client.chainSnapshot.findUnique({
      where: { scope_height: { scope: this.scope, height: cursor.height } }
    })
    if (
      !manifest ||
      manifest.hash !== cursor.hash ||
      stable(manifest.globals) !== stable(cursor.globals)
    )
      return unavailable('refund accepted manifest missing')
    const old = await this.exits.find(this.scope, chainOrderId)
    if (old) {
      const at = await this.observer.atHeight(old.finalizedHeight.toString(), head)
      if (at.hash !== old.finalizedHash) contradiction('independent refund finalized block changed')
    }
    const terms = await this.client.paymentOrderTerms.findUniqueOrThrow({ where: { orderId } })
    const hints = await this.client.chainEvent.findMany({
      where: {
        scope: this.scope,
        name: { in: ['Deposited', 'Refunded'] },
        args: { path: ['orderId'], equals: chainOrderId }
      }
    })
    const events: VerifiedEvent[] = []
    for (const name of ['Deposited', 'Refunded']) {
      const hint = hints.find((e) => e.name === name)
      if (!hint) return unavailable('refund event basis missing')
      const scan = await this.observer.scanAndVerify(hint.height.toString(), [chainOrderId])
      const e = scan.events.find(
        (e) =>
          e.name === name &&
          e.args.orderId === chainOrderId &&
          e.txHash === hint.txHash &&
          e.logIndex === hint.logIndex.toString() &&
          e.blockHash === hint.blockHash
      )
      if (!e) return contradiction('refund event differs from verified receipt')
      events.push(e)
    }
    const [deposit, refund] = events
    const intents = await this.client.paymentIntent.findMany({ where: { orderId } })
    const i = intents.find(
      (i) => (i.permit as { intentId: string }).intentId === deposit.args.intentId
    )
    if (!i) return unavailable('funded issuance mapping missing')
    const record: IssuanceRecord = {
      id: i.id,
      orderId,
      listingId: terms.listingId,
      stockId: terms.stockId,
      scope: this.scope,
      digest: i.digest,
      termsHash: terms.termsHash,
      recoveryEpoch: terms.recoveryEpoch,
      permit: i.permit as unknown as PaymentPermit,
      previousIntentId: i.previousIntentId
    }
    const order = await this.observer.readOrder(chainOrderId, head)
    const stock = {
      stockId: terms.stockId,
      occupant: String(await this.observer.call('stockOccupant', [terms.stockId], head)),
      generation: String(await this.observer.call('stockGeneration', [terms.stockId], head))
    }
    const evidence: RefundEvidence = {
      schemaVersion: 1,
      record,
      snapshot: head,
      deploymentHash: deploymentDigest(this.observer.config, this.observer.deployment),
      order,
      stock,
      deposit,
      refund
    }
    validateRefundEvidence(evidence)
    if (old && stable(old.evidence.order) !== stable(order))
      return contradiction('independent refund facts changed')
    return this.exits.record(evidence, options)
  }
  async apply(exit: RefundExit, options: TransactionOptions = {}) {
    validateRefundExit(exit)
    if (
      exit.scope !== this.scope ||
      exit.chainId !== this.observer.config.chainId ||
      exit.escrow !== this.observer.config.escrow ||
      exit.evidence.deploymentHash !==
        deploymentDigest(this.observer.config, this.observer.deployment)
    )
      throw new DomainError('WALLET_UNAVAILABLE')
    const result = await transact(
      this.client,
      async (tx) => {
        await lockChain(tx, this.scope)
        await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id"=${exit.listingId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${exit.orderId}::uuid FOR UPDATE`
        const cursor = await tx.scanCheckpoint.findUnique({ where: { scope: this.scope } })
        const projection = await tx.escrowProjection.findUnique({
          where: { scope_chainOrderId: { scope: this.scope, chainOrderId: exit.chainOrderId } }
        })
        const stock = await tx.testnetStock.findUnique({ where: { listingId: exit.listingId } })
        const digital = await tx.digitalInventory.findUnique({
          where: { listingId: exit.listingId }
        })
        if (
          !cursor ||
          cursor.height < exit.finalizedHeight ||
          cursor.status !== 'active' ||
          !projection ||
          projection.state !== 'Refunded' ||
          projection.holdReason ||
          projection.businessOrderId !== exit.orderId ||
          projection.height !== cursor.height ||
          projection.blockHash !== cursor.hash ||
          !stock ||
          !digital
        )
          throw new DomainError('WALLET_UNAVAILABLE')
        const o = projection.data as {
          credentialId: string
          generation: string
          deliveredAt: string
        }
        if (o.credentialId !== zero || o.deliveredAt !== '0' || o.generation !== exit.generation)
          throw new DomainError('WALLET_UNAVAILABLE')
        const same =
          stock.stockId === exit.stockId &&
          stock.generation === exit.generation &&
          stock.activeOrderId === exit.orderId
        const restored =
          stock.stockId === exit.stockId &&
          stock.generation === exit.nextGeneration &&
          stock.previousOrderId === exit.chainOrderId &&
          stock.activeOrderId === null &&
          stock.lastOrderId === exit.orderId &&
          ['free', 'protected'].includes(stock.state)
        if (!same && !restored) return { status: 'superseded' } as const
        if (digital.activeOrderId !== exit.orderId && digital.activeOrderId !== null)
          return { status: 'superseded' } as const
        return this.exits.withHead(exit, async (current) => {
          const old = await tx.refundInventoryTransition.findUnique({
            where: { scope_chainOrderId: { scope: this.scope, chainOrderId: exit.chainOrderId } }
          })
          if (old && old.basisHash !== current.basisHash)
            throw new DomainError('WALLET_UNAVAILABLE')
          await tx.testnetStock.update({
            where: { listingId: exit.listingId },
            data: {
              state: 'free',
              activeOrderId: null,
              generation: exit.nextGeneration,
              previousOrderId: exit.chainOrderId,
              lastOrderId: exit.orderId
            }
          })
          await tx.digitalInventory.update({
            where: { listingId: exit.listingId },
            data: { availability: 'available', activeOrderId: null, version: { increment: 1 } }
          })
          await tx.refundInventoryTransition.upsert({
            where: { scope_chainOrderId: { scope: this.scope, chainOrderId: exit.chainOrderId } },
            create: {
              scope: this.scope,
              chainOrderId: exit.chainOrderId,
              orderId: exit.orderId,
              stockId: exit.stockId,
              generation: exit.generation,
              nextGeneration: exit.nextGeneration,
              basisHash: exit.basisHash
            },
            update: {}
          })
          await options.checkpoint?.('before-refund-business-commit', tx, 1)
          return { status: 'applied' } as const
        })
      },
      options
    )
    await options.checkpoint?.('after-refund-business-commit', this.client, 1)
    return result
  }
}
