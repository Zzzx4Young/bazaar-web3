import type { Hex } from 'viem'
import type { PrismaClient, Listing } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { requireActiveAccount } from '../accounts/require-active-account.js'
import { idInput } from '../common/input.js'
import type { Authenticated } from '../auth/auth.service.js'
import { WalletAuthService } from '../auth/wallet-auth.service.js'
import type { WalletSecurityLedger } from '../auth/wallet-security-ledger.js'
import type { EvmAddress, Web3Config } from './web3-types.js'
import { requireTestnetFile } from './testnet-price.js'

export class SellerPayoutService {
  constructor(private readonly client: PrismaClient, private readonly wallets: WalletAuthService,
    private readonly ledger: WalletSecurityLedger, private readonly config: Web3Config) {}

  confirmSellerPayout(auth: Authenticated, challengeId: string, signature: Hex) {
    return this.wallets.consumePayoutChallenge(auth, idInput(challengeId).toLowerCase(), signature)
  }

  reconcileSellerPayout(cookie: string | undefined, id: string, signature: Hex, csrf: string | string[] | undefined) {
    return this.wallets.reconcilePayoutChallenge(cookie, idInput(id).toLowerCase(), signature, csrf)
  }

  async lockOrderAccounts(tx: Transaction, buyerId: string, listingId: string) {
    const hint = await tx.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } })
    if (!hint) throw new DomainError('NOT_FOUND')
    const ids = [buyerId, hint.sellerId].sort()
    for (const id of ids) await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${id}::uuid FOR UPDATE`
    await requireActiveAccount(tx, buyerId)
    await requireActiveAccount(tx, hint.sellerId)
  }

  async assertNewOrderEligibility(tx: Transaction, listing: Listing) {
    requireTestnetFile(listing)
    const price = await tx.listingTestnetPrice.findUnique({ where: { listingId_listingVersion: {
      listingId: listing.id, listingVersion: listing.version } } })
    if (!price || price.chainId !== this.config.chainId || price.token !== this.config.token ||
      price.escrow !== this.config.escrow) throw new DomainError('STATE_CONFLICT')
    const identity = await tx.walletIdentity.findUnique({ where: { accountId_chainId: {
      accountId: listing.sellerId, chainId: this.config.chainId } } })
    const trusted = await this.ledger.assertProjection({ accountId: listing.sellerId, chainId: this.config.chainId,
      address: identity?.address as EvmAddress | null ?? null, bindingVersion: identity?.bindingVersion ?? 0,
      revision: String(identity?.securityRevision ?? 0) })
    if (!trusted.address || !trusted.payout || trusted.payout.wallet !== trusted.address ||
      trusted.payout.escrow !== this.config.escrow) throw new DomainError('STATE_CONFLICT')
    const confirmation = await tx.sellerPayoutConfirmation.findUnique({ where: { id: trusted.payout.confirmationId } })
    if (!confirmation || confirmation.revokedAt || confirmation.accountId !== listing.sellerId ||
      confirmation.chainId !== this.config.chainId || confirmation.wallet !== trusted.address ||
      confirmation.escrow !== this.config.escrow || confirmation.bindingVersion !== trusted.bindingVersion)
      throw new DomainError('STATE_CONFLICT')
    return { listingId: listing.id, sellerId: listing.sellerId, listingVersion: listing.version,
      priceId: price.id, chainId: price.chainId, token: price.token, escrow: price.escrow,
      amountAtoms: price.amountAtoms, sellerWallet: confirmation.wallet,
      sellerBindingVersion: confirmation.bindingVersion, payoutConfirmationId: confirmation.id }
  }

  // Historical terms are authorization to read an immutable order snapshot, not
  // authorization to mint a payment permit. T04 must additionally prove intent/stock safety.
  async existingOrderTerms(actorId: string, orderId: string) {
    return existingOrderTerms(this.client, actorId, orderId)
  }
}

export async function existingOrderTerms(client: PrismaClient, actorId: string, orderId: string) {
  const order = await client.order.findFirst({ where: { id: orderId, settlementMode: 'testnet_escrow',
    OR: [{ buyerId: actorId }, { sellerId: actorId }] }, include: { testnetSnapshot: true } })
  if (!order?.testnetSnapshot) throw new DomainError('NOT_FOUND')
  return order.testnetSnapshot
}
