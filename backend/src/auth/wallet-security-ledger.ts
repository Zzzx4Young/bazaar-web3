import type { EvmAddress } from '../web3/web3-types.js'

// This contract is implemented against a separately provisioned ledger, never
// against tables restored with the business Prisma schema.
export interface WalletSecuritySnapshot {
  accountId: string
  chainId: number
  address: EvmAddress | null
  bindingVersion: number
  revision: string
  payout: { wallet: EvmAddress; escrow: EvmAddress; confirmationId: string } | null
  pendingOperationId: string | null
  recoveryEpoch: string
}

export interface WalletSecurityChange {
  operationId: string
  operation: 'bind' | 'unbind' | 'payout'
  accountId: string
  chainId: number
  expectedRevision: string
  expectedBindingVersion: number
  address: EvmAddress | null
  payout: WalletSecuritySnapshot['payout']
  requestHash: string
}

export interface WalletSecurityLedger {
  read(accountId: string, chainId: number): Promise<WalletSecuritySnapshot>
  claimOwner(chainId: number, address: EvmAddress): Promise<string | null>
  prepare(change: WalletSecurityChange): Promise<WalletSecuritySnapshot>
  commit(operationId: string): Promise<WalletSecuritySnapshot>
  // Only a transaction known to have rolled back may call abort. A missing
  // operation after restoring an old backup is not evidence of rollback.
  abort(operationId: string): Promise<void>
  recoveryEpoch(): Promise<string>
  assertProjection(projection: Pick<WalletSecuritySnapshot,
    'accountId' | 'chainId' | 'address' | 'bindingVersion' | 'revision'>): Promise<WalletSecuritySnapshot>
}
