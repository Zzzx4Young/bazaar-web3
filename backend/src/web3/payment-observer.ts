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
}
export interface PaymentChainObserver {
  readIntent(permit: PaymentPermit): Promise<VerifiedIntentState>
}
