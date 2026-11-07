import { isDeepStrictEqual } from 'node:util'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import type { PaymentPermit } from './web3-types.js'
import type { VerifiedIntentState } from './payment-observer.js'

export interface IssuanceRecord {
  id: string
  orderId: string
  listingId: string
  stockId: string
  scope: string
  digest: string
  termsHash: string
  recoveryEpoch: string
  permit: PaymentPermit
  previousIntentId: string | null
}
export interface PaymentJournal {
  authorize(record: IssuanceRecord): Promise<void>
  resolve(
    record: IssuanceRecord,
    outcome: 'invalid' | 'funded',
    evidence: VerifiedIntentState
  ): Promise<void>
}
export class PostgresPaymentJournal implements PaymentJournal {
  constructor(
    private readonly client: PrismaClient,
    private readonly ledgerId: string
  ) {}
  private async transaction<T>(work: (tx: Transaction) => Promise<T>) {
    try {
      return await this.client.$transaction(async (tx) => {
        const [meta] = await tx.$queryRaw<
          { ledgerId: string; recoveryEpoch: string; maintenance: boolean; writable: boolean }[]
        >`
        SELECT *, (NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off') AS writable
        FROM "WalletLedgerMeta" WHERE "singleton" = true`
        if (!meta || meta.ledgerId !== this.ledgerId || meta.maintenance || !meta.writable)
          throw new DomainError('WALLET_UNAVAILABLE')
        return work(tx)
      })
    } catch (e) {
      if (e instanceof DomainError) throw e
      throw new DomainError('WALLET_UNAVAILABLE')
    }
  }
  private async head(tx: Transaction, r: IssuanceRecord) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${r.scope + ':' + r.listingId}, 0))`
    const [meta] = await tx.$queryRaw<
      { recoveryEpoch: string }[]
    >`SELECT "recoveryEpoch" FROM "WalletLedgerMeta" WHERE "singleton" = true`
    if (meta.recoveryEpoch !== r.recoveryEpoch) throw new DomainError('WALLET_UNAVAILABLE')
    const [head] = await tx.$queryRaw<{ intentId: string; stockId: string }[]>`
      SELECT * FROM "PaymentLedgerHead" WHERE "scope" = ${r.scope} AND "listingId" = ${r.listingId}::uuid`
    return head
  }
  async authorize(r: IssuanceRecord) {
    await this.transaction(async (tx) => {
      const head = await this.head(tx, r)
      const [prior] = await tx.$queryRaw<
        IssuanceRecord[]
      >`SELECT "id", "orderId", "listingId", "stockId", "scope",
        "digest", "termsHash", "recoveryEpoch", "permit", "previousIntentId" FROM "PaymentLedgerIntent" WHERE "id" = ${r.id}::uuid`
      if (prior) {
        const resolutions = await tx.$queryRaw<
          { id: number }[]
        >`SELECT 1 FROM "PaymentLedgerResolution" WHERE "intentId" = ${r.id}::uuid`
        if (!isDeepStrictEqual(prior, r) || head?.intentId !== r.id || resolutions.length)
          throw new DomainError('WALLET_UNAVAILABLE')
        return
      }
      if (head) {
        const [ended] = await tx.$queryRaw<
          { outcome: string }[]
        >`SELECT "outcome" FROM "PaymentLedgerResolution" WHERE "intentId" = ${head.intentId}::uuid`
        if (
          head.stockId !== r.stockId ||
          r.previousIntentId !== head.intentId ||
          ended?.outcome !== 'invalid'
        )
          throw new DomainError('WALLET_UNAVAILABLE')
      } else if (r.previousIntentId) throw new DomainError('WALLET_UNAVAILABLE')
      const [oldTerms] = await tx.$queryRaw<
        { termsHash: string }[]
      >`SELECT "termsHash" FROM "PaymentLedgerIntent"
        WHERE "orderId" = ${r.orderId}::uuid AND "scope" = ${r.scope} LIMIT 1`
      if (oldTerms && oldTerms.termsHash !== r.termsHash)
        throw new DomainError('WALLET_UNAVAILABLE')
      await tx.$executeRaw`INSERT INTO "PaymentLedgerIntent" ("id","orderId","listingId","stockId","scope","digest","termsHash","recoveryEpoch","permit","previousIntentId")
        VALUES (${r.id}::uuid,${r.orderId}::uuid,${r.listingId}::uuid,${r.stockId},${r.scope},${r.digest},${r.termsHash},${r.recoveryEpoch}::uuid,${JSON.stringify(r.permit)}::jsonb,${r.previousIntentId}::uuid)`
      await tx.$executeRaw`INSERT INTO "PaymentLedgerHead" ("scope","listingId","stockId","intentId")
        VALUES (${r.scope},${r.listingId}::uuid,${r.stockId},${r.id}::uuid)
        ON CONFLICT ("scope","listingId") DO UPDATE SET "intentId" = EXCLUDED."intentId"`
    })
  }
  async resolve(r: IssuanceRecord, outcome: 'invalid' | 'funded', evidence: VerifiedIntentState) {
    await this.transaction(async (tx) => {
      const head = await this.head(tx, r)
      const [issued] = await tx.$queryRaw<
        { digest: string }[]
      >`SELECT "digest" FROM "PaymentLedgerIntent" WHERE "id" = ${r.id}::uuid`
      if (head?.intentId !== r.id || issued?.digest !== r.digest)
        throw new DomainError('WALLET_UNAVAILABLE')
      const [old] = await tx.$queryRaw<
        { outcome: string }[]
      >`SELECT "outcome" FROM "PaymentLedgerResolution" WHERE "intentId" = ${r.id}::uuid`
      if (old) {
        if (old.outcome !== outcome) throw new DomainError('WALLET_UNAVAILABLE')
        return
      }
      await tx.$executeRaw`INSERT INTO "PaymentLedgerResolution" ("intentId","outcome","evidence")
        VALUES (${r.id}::uuid,${outcome},${JSON.stringify(evidence)}::jsonb)`
    })
  }
}
