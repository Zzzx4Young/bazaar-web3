import { deploymentDigest } from './escrow-projector.js'
import { RefundJournal, validateRefundExit, type RefundExit } from './refund-journal.js'
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
  assertHistoricalRefund?(record: IssuanceRecord): Promise<void>
  assertUnfundedSuccessor?(record: IssuanceRecord, state: VerifiedIntentState): Promise<void>
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
      let afterExit: string | null = null
      for (;;) {
        const exits: RefundExit[] = await tx.$queryRaw<
          RefundExit[]
        >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${scope} AND (${afterExit}::text IS NULL OR "chainOrderId">${afterExit}) ORDER BY "chainOrderId" LIMIT 128`
        if (!exits.length) break
        const ids = exits.map((e) => e.fundedIntentId)
        const issued = await tx.$queryRaw<
          IssuanceRecord[]
        >`SELECT "id","orderId","listingId","stockId","scope","digest","termsHash","recoveryEpoch","permit","previousIntentId" FROM "PaymentLedgerIntent" WHERE "id"=ANY(${ids}::uuid[])`
        const records = new Map(issued.map((i) => [i.id, i]))
        for (const exit of exits) {
          validateRefundExit(exit)
          if (stable(records.get(exit.fundedIntentId)) !== stable(exit.evidence.record))
            throw new DomainError('WALLET_UNAVAILABLE')
        }
        afterExit = exits[exits.length - 1].chainOrderId
      }
      let after: string | null = null
      for (;;) {
        const heads: {
          listingId: string
          stockId: string
          intentId: string
          orderId: string
          permit: PaymentPermit
          outcome: string | null
        }[] = await tx.$queryRaw<
          {
            listingId: string
            stockId: string
            intentId: string
            orderId: string
            permit: PaymentPermit
            outcome: string | null
          }[]
        >`SELECT h."listingId",h."stockId",h."intentId",i."orderId",i."permit",r."outcome" FROM "PaymentLedgerHead" h JOIN "PaymentLedgerIntent" i ON i."id"=h."intentId" LEFT JOIN "PaymentLedgerResolution" r ON r."intentId"=i."id" WHERE h."scope"=${scope} AND (${after}::uuid IS NULL OR h."listingId">${after}::uuid) ORDER BY h."listingId" LIMIT 128`
        if (!heads.length) break
        for (const h of heads) {
          const stock = await business.testnetStock.findUnique({
            where: { listingId: h.listingId }
          })
          if (
            !stock ||
            stock.stockId !== h.stockId ||
            BigInt(stock.generation) < BigInt(h.permit.stockGeneration)
          )
            throw new DomainError('WALLET_UNAVAILABLE')
          if (stock.generation === h.permit.stockGeneration) {
            if (
              stock.previousOrderId !== h.permit.previousOrderId ||
              (stock.state === 'free' && h.outcome !== 'invalid') ||
              (stock.activeOrderId && stock.activeOrderId !== h.orderId && h.outcome !== 'invalid')
            )
              throw new DomainError('WALLET_UNAVAILABLE')
          } else {
            const exits = await tx.$queryRaw<
              RefundExit[]
            >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${scope} AND "fundedIntentId"=${h.intentId}::uuid`
            if (exits.length !== 1) throw new DomainError('WALLET_UNAVAILABLE')
            const exit = validateRefundExit(exits[0])
            if (
              exit.nextGeneration !== stock.generation ||
              exit.chainOrderId !== stock.previousOrderId ||
              exit.stockId !== stock.stockId ||
              stable(exit.evidence.record.permit) !== stable(h.permit)
            )
              throw new DomainError('WALLET_UNAVAILABLE')
            if (stock.activeOrderId) {
              const terms = await business.paymentOrderTerms.findUnique({
                where: { orderId: stock.activeOrderId }
              })
              const p = terms?.terms as PaymentPermit | undefined
              if (
                !p ||
                p.stockId !== exit.stockId ||
                p.stockGeneration !== exit.nextGeneration ||
                p.previousOrderId !== exit.chainOrderId
              )
                throw new DomainError('WALLET_UNAVAILABLE')
            }
          }
        }
        after = heads[heads.length - 1].listingId
      }
    }, true)
  }
  async assertHistoricalRefund(r: IssuanceRecord) {
    const exit = await new RefundJournal(this.client, this.ledgerId).find(r.scope, r.permit.orderId)
    if (!exit || exit.fundedIntentId !== r.id || stable(exit.evidence.record) !== stable(r))
      throw new DomainError('WALLET_UNAVAILABLE')
  }
  async assertUnfundedSuccessor(r: IssuanceRecord, s: VerifiedIntentState) {
    const e = await new RefundJournal(this.client, this.ledgerId).find(
      r.scope,
      r.permit.previousOrderId
    )
    if (
      !e ||
      e.nextGeneration !== r.permit.stockGeneration ||
      e.stockId !== r.stockId ||
      e.chainId !== r.permit.chainId ||
      e.escrow !== r.permit.escrow ||
      e.orderId === r.orderId ||
      e.evidence.record.permit.token !== r.permit.token ||
      e.generation !== s.stockGeneration ||
      s.stockOccupant !== e.chainOrderId ||
      BigInt(s.snapshot.height) < e.finalizedHeight ||
      !s.predecessor ||
      stable(s.predecessor) !== stable(e.evidence.order)
    )
      throw new DomainError('WALLET_UNAVAILABLE')
  }
  private async resolutionWatermark(scope: string) {
    return this.transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { count: string; epoch: string; exits: string }[]
      >`SELECT count(*)::text AS count,(SELECT count(*)::text FROM "PaymentLedgerRefundExit" WHERE "scope"=${scope}) AS exits,(SELECT "recoveryEpoch"::text FROM "WalletLedgerMeta" WHERE "singleton"=true) AS epoch FROM "PaymentLedgerResolution" r JOIN "PaymentLedgerIntent" i ON i."id"=r."intentId" WHERE i."scope"=${scope}`
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
            'orderTermsHash',
            'predecessor'
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
    if (initial.exits !== '0') {
      const head = await observer.readVerifiedSnapshot()
      let after: string | null = null
      for (;;) {
        const exits = await this.transaction(
          (tx) =>
            tx.$queryRaw<
              RefundExit[]
            >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${scope} AND (${after}::text IS NULL OR "chainOrderId">${after}) ORDER BY "chainOrderId" LIMIT 128`
        )
        if (!exits.length) break
        for (const row of exits) {
          validateRefundExit(row)
          const at = await observer.atHeight(row.finalizedHeight.toString(), head)
          if (
            at.hash !== row.finalizedHash ||
            row.evidence.deploymentHash !== deploymentDigest(observer.config, observer.deployment)
          )
            return contradiction('independent refund finalized basis changed')
          const order = await observer.readOrder(row.chainOrderId as `0x${string}`, at)
          if (stable(order) !== stable(row.evidence.order))
            return contradiction('independent refund order facts changed')
        }
        after = exits[exits.length - 1].chainOrderId
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
        if (head.stockId !== r.stockId || r.previousIntentId !== head.intentId)
          throw new DomainError('WALLET_UNAVAILABLE')
        const [prior] = await tx.$queryRaw<
          { orderId: string; permit: PaymentPermit }[]
        >`SELECT "orderId","permit" FROM "PaymentLedgerIntent" WHERE "id"=${head.intentId}::uuid`
        if (!prior) throw new DomainError('WALLET_UNAVAILABLE')
        if (ended?.outcome === 'invalid') {
          if (
            r.permit.stockGeneration !== prior.permit.stockGeneration ||
            r.permit.previousOrderId !== prior.permit.previousOrderId
          )
            throw new DomainError('WALLET_UNAVAILABLE')
        } else {
          const [exit] = await tx.$queryRaw<
            RefundExit[]
          >`SELECT * FROM "PaymentLedgerRefundExit" WHERE "scope"=${r.scope} AND "fundedIntentId"=${head.intentId}::uuid`
          if (!exit) throw new DomainError('WALLET_UNAVAILABLE')
          validateRefundExit(exit)
          if (
            exit.fundedIntentId !== head.intentId ||
            stable(exit.evidence.record.permit) !== stable(prior.permit) ||
            r.orderId === prior.orderId ||
            r.permit.orderId === exit.chainOrderId ||
            r.permit.stockGeneration !== exit.nextGeneration ||
            r.permit.previousOrderId !== exit.chainOrderId ||
            r.permit.chainId !== exit.chainId ||
            r.permit.escrow !== exit.escrow ||
            r.permit.stockId !== exit.stockId ||
            r.permit.token !== prior.permit.token
          )
            throw new DomainError('WALLET_UNAVAILABLE')
        }
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
