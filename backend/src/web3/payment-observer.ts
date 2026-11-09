import type { ObservedOrder } from './escrow-state.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { DualChainObserver, unavailable, contradiction } from './chain-observer.js'
import { chainScope, deploymentDigest } from './escrow-projector.js'
import type { Bytes32, FinalizedSnapshot, PaymentPermit } from './web3-types.js'

// Trusted server dependency, never an HTTP request body. T07 supplies production
// reads at a common verified finalized block and checks receipts/events/state.
export interface VerifiedIntentState {
  snapshot: FinalizedSnapshot
  intentId: Bytes32
  orderId: Bytes32
  stockId: Bytes32
  orderState: 'None' | 'Funded' | 'Delivered' | 'Disputed' | 'Released' | 'Refunded'
  intentRevoked: boolean
  signerRevoked: boolean
  stockGeneration: string
  stockOccupant: Bytes32
  orderTermsHash: Bytes32 | null
  predecessor?: ObservedOrder
}
export interface PaymentChainObserver {
  readIntent(permit: PaymentPermit): Promise<VerifiedIntentState>
}

// Read existing accepted progress before allowing T04 to retire/release an intent.
export class CheckpointPaymentObserver implements PaymentChainObserver {
  constructor(
    readonly client: PrismaClient,
    readonly observer: DualChainObserver
  ) {}
  async readIntent(permit: PaymentPermit) {
    const cursor = await this.client.scanCheckpoint.findUnique({
      where: { scope: chainScope(this.observer.config) }
    })
    if (
      !cursor ||
      cursor.status !== 'active' ||
      cursor.configHash !== deploymentDigest(this.observer.config, this.observer.deployment)
    )
      return unavailable('protected payment checkpoint')
    const head = await this.observer.readVerifiedSnapshot()
    if (BigInt(head.height) < cursor.height)
      return unavailable('payment observer behind accepted progress')
    if (
      cursor.height >= cursor.deploymentBlock &&
      (await this.observer.atHeight(cursor.height.toString(), head)).hash !== cursor.hash
    )
      return contradiction('payment observer conflicts with accepted finalized cursor')
    if (cursor.height.toString() !== head.height || cursor.hash !== head.hash)
      return unavailable('complete finalized projection pending')
    const state = await this.observer.readIntent(permit, head)
    if (state.orderState !== 'None') {
      const projected = await this.client.escrowProjection.findUnique({
        where: {
          scope_chainOrderId: {
            scope: chainScope(this.observer.config),
            chainOrderId: permit.orderId
          }
        }
      })
      if (
        !projected ||
        projected.height !== cursor.height ||
        projected.blockHash !== cursor.hash ||
        projected.state !== state.orderState
      )
        return unavailable('complete funded projection missing')
    }
    return state
  }
}
