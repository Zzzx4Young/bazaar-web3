import type { DeliveryPermit, Web3Config } from '../web3/web3-types.js'
export const deliveryTypes = {
  DeliveryPermit: [
    { name: 'schemaVersion', type: 'uint256' },
    { name: 'credentialId', type: 'bytes32' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'seller', type: 'address' },
    { name: 'deliveryVersion', type: 'bytes32' },
    { name: 'manifestCommitment', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'signerKeyId', type: 'bytes32' }
  ]
} as const
export function deliveryTypedData(p: DeliveryPermit, c: Pick<Web3Config, 'chainId' | 'escrow'>) {
  return {
    domain: {
      name: 'Bazaar Testnet Escrow',
      version: '1',
      chainId: c.chainId,
      verifyingContract: c.escrow
    },
    types: deliveryTypes,
    primaryType: 'DeliveryPermit' as const,
    message: {
      ...p,
      schemaVersion: 1n,
      issuedAt: BigInt(p.issuedAt),
      expiresAt: BigInt(p.expiresAt)
    }
  }
}
