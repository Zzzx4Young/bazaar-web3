import type { PrismaClient } from '../generated/prisma/client.js'
import { DomainError } from '../common/domain-error.js'
import { stable, unavailable, contradiction, ChainVerificationError } from './chain-observer.js'
import type { ChainIndexer } from './chain-indexer.js'
import type { Bytes32, FinalizedSnapshot } from './web3-types.js'
export class EscrowReconciliation {
  constructor(
    readonly client: PrismaClient,
    readonly indexer: ChainIndexer
  ) {}
  // Internal worker interface. An HTTP caller must never supply a trusted H.
  async reconcileOrder(orderId: string, expected?: FinalizedSnapshot) {
    const basis = await this.client.paymentOrderTerms.findUnique({ where: { orderId } })
    if (!basis) throw new DomainError('WALLET_UNAVAILABLE')
    const terms = basis.terms as { orderId: Bytes32 }
    try {
      await this.indexer.runOnce()
      const head = await this.indexer.observer.readVerifiedSnapshot(),
        scope = this.indexer.projector.scope
      const cursor = await this.client.scanCheckpoint.findUnique({ where: { scope } })
      if (
        !cursor ||
        cursor.status === 'isolated' ||
        cursor.height.toString() !== head.height ||
        cursor.hash !== head.hash ||
        (expected && (expected.height !== head.height || expected.hash !== head.hash))
      )
        return unavailable('full common finalized projection not yet available')
      const chain = await this.indexer.observer.readOrder(terms.orderId, head)
      const projected = await this.client.escrowProjection.findUnique({
        where: { scope_chainOrderId: { scope, chainOrderId: terms.orderId } }
      })
      if (
        (chain.state === 'None' && projected) ||
        (chain.state !== 'None' && (!projected || stable(projected.data) !== stable(chain)))
      )
        return contradiction('order reconciliation differs from accepted H')
      return {
        state: chain.state,
        snapshot: head,
        recoveryStatus: cursor.status,
        inventoryProtection: 'held' as const,
        downloadEnabled: false,
        missingData: projected?.holdReason ?? null
      }
    } catch (e) {
      if (e instanceof ChainVerificationError && e.kind === 'contradiction')
        await this.indexer.projector.isolate(e.reason, { orderId })
      throw e
    }
  }
}
