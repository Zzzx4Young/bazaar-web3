import {
  ChainVerificationError,
  contradiction,
  unavailable,
  stable,
  type DualChainObserver
} from './chain-observer.js'
import type { VerifiedRange } from './escrow-state.js'
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
  assertBusinessBasis?(business: PrismaClient, scope: string): Promise<void>
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
  private async transaction<T>(work: (tx: Transaction) => Promise<T>, snapshot = false) {
    try {
      return await this.client.$transaction(
        async (tx) => {
          const [meta] = await tx.$queryRaw<
            { ledgerId: string; recoveryEpoch: string; maintenance: boolean; writable: boolean }[]
          >`
        SELECT *, (NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off') AS writable
        FROM "WalletLedgerMeta" WHERE "singleton" = true`
          if (!meta || meta.ledgerId !== this.ledgerId || meta.maintenance || !meta.writable)
            throw new DomainError('WALLET_UNAVAILABLE')
          return work(tx)
        },
        snapshot ? { isolationLevel: 'RepeatableRead', timeout: 10000 } : undefined
      )
    } catch (e) {
      if (e instanceof DomainError || e instanceof ChainVerificationError) throw e
      throw new DomainError('WALLET_UNAVAILABLE')
    }
  }
  async assertBusinessBasis(business: PrismaClient, scope: string) {
    await this.transaction(async (tx) => {
      let last: string | null = null
      for (;;) {
        const issued: {
          id: string
          orderId: string
          stockId: string
          digest: string
          termsHash: string
          permit: PaymentPermit
        }[] = await tx.$queryRaw<
          {
            id: string
            orderId: string
            stockId: string
            digest: string
            termsHash: string
            permit: PaymentPermit
          }[]
        >`SELECT "id","orderId","stockId","digest","termsHash","permit" FROM "PaymentLedgerIntent" WHERE "scope"=${scope} AND (${last}::uuid IS NULL OR "id">${last}::uuid) ORDER BY "id" LIMIT 128`
        if (!issued.length) break
        const [intents, terms] = await Promise.all([
          business.paymentIntent.findMany({ where: { id: { in: issued.map((r) => r.id) } } }),
          business.paymentOrderTerms.findMany({
            where: { orderId: { in: issued.map((r) => r.orderId) } }
          })
        ])
        const byIntent = new Map(intents.map((r) => [r.id, r])),
          byOrder = new Map(terms.map((r) => [r.orderId, r]))
        for (const r of issued) {
          const i = byIntent.get(r.id),
            t = byOrder.get(r.orderId)
          if (
            !i ||
            !t ||
            i.orderId !== r.orderId ||
            i.digest !== r.digest ||
            t.stockId !== r.stockId ||
            t.termsHash !== r.termsHash ||
            !isDeepStrictEqual(i.permit, r.permit)
          )
            throw new DomainError('WALLET_UNAVAILABLE')
        }
        last = issued[issued.length - 1].id
      }
    }, true)
  }
  private async resolutionWatermark(scope: string) {
    return this.transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { count: string; epoch: string }[]
      >`SELECT count(*)::text AS count,(SELECT "recoveryEpoch"::text FROM "WalletLedgerMeta" WHERE "singleton"=true) AS epoch FROM "PaymentLedgerResolution" r JOIN "PaymentLedgerIntent" i ON i."id"=r."intentId" WHERE i."scope"=${scope}`
      return row
    })
  }
  async assertResolutions(
    range: Pick<VerifiedRange, 'snapshot' | 'events'>,
    observer: DualChainObserver
  ): Promise<() => Promise<void>> {
    const scope = range.snapshot.chainId + ':' + observer.config.escrow
    const initial = await this.resolutionWatermark(scope)
    const unchanged = async () => {
      const current = await this.resolutionWatermark(scope)
      if (stable(current) !== stable(initial))
        return unavailable('independent resolution watermark changed; retry verification')
    }
    if (initial.count !== '0') {
      const head = await observer.readVerifiedSnapshot()
      let last: string | null = null
      for (;;) {
        const page: {
          id: string
          outcome: 'invalid' | 'funded'
          evidence: VerifiedIntentState
          permit: PaymentPermit
        }[] = await this.transaction(
          (tx) =>
            tx.$queryRaw`SELECT i."id",i."permit",r."outcome",r."evidence" FROM "PaymentLedgerResolution" r JOIN "PaymentLedgerIntent" i ON i."id"=r."intentId" WHERE i."scope"=${scope} AND (${last}::uuid IS NULL OR i."id">${last}::uuid) ORDER BY i."id" LIMIT 128`
        )
        if (!page.length) break
        for (const row of page) {
          const expected = row.evidence,
            at = expected.snapshot
          if (
            !at ||
            at.chainId !== range.snapshot.chainId ||
            !/^0x[0-9a-f]{64}$/.test(at.hash) ||
            !/^(0|[1-9][0-9]*)$/.test(at.height)
          )
            return unavailable('independent resolution evidence missing')
          const verified = await observer.atHeight(at.height, head)
          if (verified.hash !== at.hash)
            return contradiction('independent accepted finalized resolution block changed', {
              intentId: row.id,
              height: at.height,
              acceptedHash: at.hash,
              observedHash: verified.hash
            })
          const actual = await observer.readIntent(row.permit, verified)
          const keys = [
            'intentId',
            'orderId',
            'stockId',
            'orderState',
            'intentRevoked',
            'signerRevoked',
            'stockGeneration',
            'stockOccupant',
            'orderTermsHash'
          ] as const
          if (keys.some((key) => stable(actual[key]) !== stable(expected[key])))
            return contradiction('independent accepted finalized resolution facts changed', {
              intentId: row.id,
              height: at.height,
              acceptedHash: at.hash
            })
          if (
            row.outcome === 'invalid' &&
            range.events.some(
              (e) =>
                e.name === 'Deposited' &&
                e.args.orderId === row.permit.orderId &&
                (e.args.intentId === row.permit.intentId || BigInt(e.height) <= BigInt(at.height))
            )
          )
            return contradiction('funding contradicts independent accepted invalidity', {
              intentId: row.id,
              height: at.height,
              orderId: row.permit.orderId
            })
        }
        last = page[page.length - 1].id
      }
    }
    await unchanged()
    // Called again while the business chain lock is held. Expensive RPC validation
    // happens before that transaction, but a concurrent new decision invalidates it.
    return unchanged
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
