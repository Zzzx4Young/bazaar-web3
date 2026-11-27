import { readFileSync, statSync } from 'node:fs'
import { encodeAbiParameters, keccak256, hashTypedData, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PaymentPermit, Bytes32, OrderTerms } from './web3-types.js'

export const paymentTypes = {
  PaymentPermit: [
    { name: 'schemaVersion', type: 'uint256' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'stockId', type: 'bytes32' },
    { name: 'stockGeneration', type: 'uint256' },
    { name: 'previousOrderId', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'refundAddress', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amountAtoms', type: 'uint256' },
    { name: 'commitmentHash', type: 'bytes32' },
    { name: 'intentId', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'payDeadline', type: 'uint256' },
    { name: 'signerKeyId', type: 'bytes32' }
  ]
} as const

export function paymentTypedData(p: PaymentPermit) {
  return {
    domain: {
      name: 'Bazaar Testnet Escrow',
      version: '1',
      chainId: p.chainId,
      verifyingContract: p.escrow
    },
    primaryType: 'PaymentPermit' as const,
    types: paymentTypes,
    message: {
      ...p,
      stockGeneration: BigInt(p.stockGeneration),
      amountAtoms: BigInt(p.amountAtoms),
      issuedAt: BigInt(p.issuedAt),
      payDeadline: BigInt(p.payDeadline),
      schemaVersion: 1n
    }
  }
}
export const paymentDigest = (p: PaymentPermit) => hashTypedData(paymentTypedData(p))
export interface PaymentSigner {
  readonly keyId: Bytes32
  sign(permit: PaymentPermit): Promise<Hex>
}
export class LocalPaymentSigner implements PaymentSigner {
  private readonly account
  constructor(
    key: Hex,
    readonly keyId: Bytes32
  ) {
    if (!/^0x[0-9a-f]{64}$/.test(keyId) || /^0x0{64}$/.test(keyId))
      throw new Error('Invalid payment key identity')
    this.account = privateKeyToAccount(key)
  }
  sign(permit: PaymentPermit) {
    if (permit.signerKeyId !== this.keyId) throw new Error('Payment key unavailable')
    return this.account.signTypedData(paymentTypedData(permit))
  }
}
// Explicit protected file only. No generated fallback key or private key in public config.
export function readPaymentSigner(file: string | undefined): PaymentSigner | null {
  if (!file) return null
  const stat = statSync(file)
  if (!stat.isFile() || stat.mode & 0o077 || stat.size > 1024)
    throw new Error('Unsafe payment signer file')
  const value = JSON.parse(readFileSync(file, 'utf8')) as { key?: Hex; keyId?: Bytes32 }
  if (!value.key || !/^0x[0-9a-f]{64}$/i.test(value.key) || !value.keyId)
    throw new Error('Invalid payment signer file')
  return new LocalPaymentSigner(value.key, value.keyId)
}

// Fixed tuple, independent of intent/key/time; ABI encoding is shared with T06.
export function orderTermsDigest(t: OrderTerms) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' }
      ],
      [
        t.orderId,
        t.stockId,
        BigInt(t.stockGeneration),
        t.previousOrderId,
        t.buyer,
        t.refundAddress,
        t.seller,
        t.token,
        BigInt(t.amountAtoms),
        t.commitmentHash
      ]
    )
  )
}
