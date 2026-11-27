import type { Listing } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import type { Web3Config } from './web3-types.js'
import { parseTestPrice } from './web3-policy.js'
export { parseTestPrice } from './web3-policy.js'

function isTestnetFile(listing: Pick<Listing, 'type' | 'saleMode' | 'commitment'>) {
  const commitment = listing.commitment
  return listing.type === 'digital' && listing.saleMode === 'one_off' && commitment &&
    typeof commitment === 'object' && !Array.isArray(commitment) && commitment.resourceMode === 'file'
}
export function requireTestnetFile(listing: Pick<Listing, 'type' | 'saleMode' | 'commitment'>) {
  if (!isTestnetFile(listing)) throw new DomainError('INVALID_INPUT')
}

export function testPriceView(amountAtoms: string) {
  const padded = amountAtoms.padStart(7, '0')
  const fraction = padded.slice(-6).replace(/0+$/, '')
  return padded.slice(0, -6) + (fraction ? `.${fraction}` : '')
}

export async function versionTestnetPrice(tx: Transaction, listing: Listing, version: number,
  explicitAmount?: string, config?: Web3Config | null) {
  if (explicitAmount !== undefined) {
    if (!config) throw new DomainError('WALLET_UNAVAILABLE')
    requireTestnetFile(listing)
    return tx.listingTestnetPrice.create({ data: { listingId: listing.id, listingVersion: version,
      chainId: config.chainId, token: config.token, escrow: config.escrow, amountAtoms: parseTestPrice(explicitAmount) } })
  }
  if (!isTestnetFile(listing)) return null
  const previous = await tx.listingTestnetPrice.findUnique({ where: { listingId_listingVersion: {
    listingId: listing.id, listingVersion: listing.version } } })
  if (!previous) return null
  return tx.listingTestnetPrice.create({ data: { listingId: listing.id, listingVersion: version,
    chainId: previous.chainId, token: previous.token, escrow: previous.escrow, amountAtoms: previous.amountAtoms } })
}
