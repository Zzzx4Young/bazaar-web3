export type EvmAddress = `0x${string}`
export type Bytes32 = `0x${string}`
export type AmountAtoms = string

export interface OrderTerms {
  orderId: Bytes32
  stockId: Bytes32
  stockGeneration: string
  previousOrderId: Bytes32
  chainId: number
  buyer: EvmAddress
  seller: EvmAddress
  refundAddress: EvmAddress
  token: EvmAddress
  escrow: EvmAddress
  amountAtoms: AmountAtoms
  commitmentHash: Bytes32
}

export interface PaymentPermit extends OrderTerms {
  schemaVersion: 1
  intentId: Bytes32
  issuedAt: number
  payDeadline: number
  signerKeyId: Bytes32
}

export interface DeliveryPermit {
  schemaVersion: 1
  credentialId: Bytes32
  orderId: Bytes32
  seller: EvmAddress
  deliveryVersion: string
  manifestCommitment: Bytes32
  issuedAt: number
  expiresAt: number
  signerKeyId: Bytes32
}

export interface FinalizedSnapshot {
  chainId: number
  height: string
  hash: Bytes32
  timestamp: number
  verifiedBy: readonly [string, string]
  verifiedAt: Date
}

export interface ChainObserver {
  readVerifiedSnapshot(): Promise<FinalizedSnapshot>
}

export interface Web3Config {
  chainId: number
  tokenDecimals: 6
  token: EvmAddress
  escrow: EvmAddress
  rpcPrimary: string
  rpcSecondary: string
  securityLedgerUrl: string
  securityLedgerId: string
}
