import type { Bytes32, EvmAddress, FinalizedSnapshot } from './web3-types.js'
import type { VerifiedBlock } from './chain-observer.js'
export interface ObservedOrder {
  orderId: Bytes32
  state: 'None' | 'Funded' | 'Delivered' | 'Disputed' | 'Released' | 'Refunded'
  buyer: EvmAddress
  refundAddress: EvmAddress
  seller: EvmAddress
  amountAtoms: string
  stockId: Bytes32
  generation: string
  fundedAt: string
  deliveredAt: string
  disputedAt: string
  credentialId: Bytes32
  deliveryVersion: Bytes32
  manifestCommitment: Bytes32
  termsHash: Bytes32
}
export interface VerifiedEvent {
  name: string
  args: Record<string, string | boolean>
  height: string
  blockHash: Bytes32
  txHash: Bytes32
  txIndex: string
  logIndex: string
}
export interface VerifiedRange {
  from: string
  snapshot: FinalizedSnapshot
  blocks: VerifiedBlock[]
  events: VerifiedEvent[]
  orders: ObservedOrder[]
  stocks: { stockId: Bytes32; occupant: Bytes32; generation: string }[]
  globals: {
    outstanding: string
    totalDeposited: string
    totalPaid: string
    balance: string
    paused: boolean
  }
}
