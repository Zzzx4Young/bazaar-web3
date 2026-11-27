import { encodeFunctionData, erc20Abi, type Abi, type Address, type Hex } from 'viem'
import { escrowAbi } from './escrow-abi'
export interface OrderAddresses {
  chainId: number
  escrow: string
  chainOrderId: string
  buyer: string
  seller: string
  refundAddress: string
}
export interface PaymentPermit {
  schemaVersion: 1
  intentId: string
  orderId: string
  stockId: string
  stockGeneration: string
  previousOrderId: string
  chainId: number
  buyer: string
  seller: string
  refundAddress: string
  token: string
  escrow: string
  amountAtoms: string
  commitmentHash: string
  issuedAt: number
  payDeadline: number
  signerKeyId: string
}
export interface IntentView {
  orderId: string
  intentId: string
  permit: PaymentPermit
  signature: string | null
  status: string
  protection: string
}
export interface DeliveryView {
  orderId: string
  chainId: number
  escrow: string
  chainOrderId: string
  state: string
  firstVersionId: string | null
  publishedVersionIds: string[]
  protectedMapping: boolean
  downloadsAvailable: boolean
  deliveryDeadline: number
  acceptanceDeadline: number | null
  disputeDeadline: number | null
  finalizedHeight: string
  finalizedBlockHash: string
  refundAddress: string
  sellerAddress: string
}
export type DirectAction =
  'accept' | 'openDispute' | 'settleExpired' | 'refundUndelivered' | 'refundDisputeTimeout'
export function buildPaymentCall(
  action: 'approve',
  terms: { token: string; escrow: string; amountAtoms: string }
): { to: string; data: Hex }
export function buildPaymentCall(
  action: 'deposit' | 'revokeIntent',
  terms: PaymentPermit,
  signature: string
): { to: string; data: Hex }
export function buildPaymentCall(
  action: 'approve' | 'deposit' | 'revokeIntent',
  terms: { token: string; escrow: string; amountAtoms: string } | PaymentPermit,
  signature?: string
) {
  if (action === 'approve')
    return {
      to: terms.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [terms.escrow as Address, BigInt(terms.amountAtoms)]
      })
    }
  return {
    to: terms.escrow,
    data: encodeFunctionData({
      abi: escrowAbi as Abi,
      functionName: action,
      args: [terms, signature]
    })
  }
}
export function buildDirectCall(action: DirectAction, escrow: string, chainOrderId: string) {
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: escrowAbi,
      functionName: action,
      args:
        action === 'openDispute'
          ? [chainOrderId as Hex, ('0x' + '00'.repeat(32)) as Hex]
          : [chainOrderId as Hex]
    })
  }
}
export function buildDeliveryCall(escrow: string, permit: unknown, signature: string) {
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: escrowAbi as Abi,
      functionName: 'registerDelivery',
      args: [permit, signature]
    })
  }
}
export function buildDirectPackage(
  order: OrderAddresses,
  snapshot?: Pick<
    DeliveryView,
    | 'state'
    | 'deliveryDeadline'
    | 'acceptanceDeadline'
    | 'disputeDeadline'
    | 'finalizedHeight'
    | 'finalizedBlockHash'
  >
) {
  return {
    schemaVersion: 1,
    testnetOnly: true,
    verifiedSnapshot: snapshot ?? null,
    ...order,
    rules: {
      paymentSeconds: 1800,
      deliverySeconds: 259200,
      acceptanceSeconds: 604800,
      disputeSeconds: 604800,
      finality: 'dual-source-finalized',
      gas: 'native test ETH; not refunded',
      deadline: 'transaction must be accepted before deadline; broadcast is insufficient'
    },
    abi: escrowAbi,
    actions: (
      [
        'accept',
        'openDispute',
        'settleExpired',
        'refundUndelivered',
        'refundDisputeTimeout'
      ] as const
    ).map((action) => ({ action, ...buildDirectCall(action, order.escrow, order.chainOrderId) }))
  }
}
