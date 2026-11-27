import { randomUUID } from 'node:crypto'
import type { Transaction } from '../database/transaction.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { LedgerWitness } from '../auth/ledger-witness.js'
import { DomainError } from '../common/domain-error.js'
import { stable } from '../web3/chain-observer.js'
export interface PrivateLedgerRecord {
  sequence: bigint
  id: string
  kind: string
  key: string
  payload: Record<string, unknown>
  createdAt: Date
}
export class PrivateLifecycleLedger {
  readonly witness: LedgerWitness
  constructor(
    readonly client: PrismaClient,
    readonly id: string,
    readonly directory: string,
    readonly now: () => Date = () => new Date(),
    checkpointGuard?: ConstructorParameters<typeof LedgerWitness>[4],
    publication?: ConstructorParameters<typeof LedgerWitness>[5]
  ) {
    this.witness = new LedgerWitness(
      client,
      id,
      directory,
      'private-files',
      checkpointGuard,
      publication
    )
  }
  async verify() {
    await this.witness.verify()
  }
  async find(kind: string, key: string) {
    return this.witness.run(async (tx) => {
      const [meta] = await tx.$queryRaw<
        { ledgerId: string; maintenance: boolean; writable: boolean }[]
      >`SELECT *, NOT pg_is_in_recovery() AND current_setting('transaction_read_only')='off' AS writable FROM "PrivateLedgerMeta" WHERE "singleton"=true`
      if (meta?.ledgerId !== this.id || meta.maintenance || !meta.writable)
        throw new DomainError('FILE_UNAVAILABLE')
      const [row] = await tx.$queryRaw<
        PrivateLedgerRecord[]
      >`SELECT * FROM "PrivateLedgerEvent" WHERE "kind"=${kind} AND "key"=${key}`
      return row ?? null
    })
  }
  async records(kind?: string) {
    return this.witness.run(async (tx) => {
      const rows: PrivateLedgerRecord[] = []
      let sequence = 0n
      for (;;) {
        const page = await tx.$queryRaw<
          PrivateLedgerRecord[]
        >`SELECT * FROM "PrivateLedgerEvent" WHERE "sequence">${sequence} AND (${kind ?? null}::text IS NULL OR "kind"=${kind ?? null}) ORDER BY "sequence" LIMIT 128`
        if (!page.length) break
        rows.push(...page)
        sequence = page.at(-1)!.sequence
      }
      return rows
    })
  }
  async append(kind: string, key: string, payload: Record<string, unknown>) {
    if (
      ![
        'delivery',
        'publication',
        'evidence',
        'terminal',
        'review',
        'claim',
        'deleted',
        'backup_prepared',
        'backup',
        'backup_deleted',
        'restore'
      ].includes(kind) ||
      !key ||
      key.length > 300
    )
      throw new DomainError('INVALID_INPUT')
    return this.witness.run((tx) => this.appendWithin(tx, kind, key, payload))
  }
  private async appendWithin(
    tx: Transaction,
    kind: string,
    key: string,
    payload: Record<string, unknown>
  ) {
    const [meta] = await tx.$queryRaw<
      { maintenance: boolean; writable: boolean }[]
    >`SELECT "maintenance",NOT pg_is_in_recovery() AND current_setting('transaction_read_only')='off' AS writable FROM "PrivateLedgerMeta" WHERE "singleton"=true`
    if (!meta || meta.maintenance || !meta.writable) throw new DomainError('FILE_UNAVAILABLE')
    const [old] = await tx.$queryRaw<
      PrivateLedgerRecord[]
    >`SELECT * FROM "PrivateLedgerEvent" WHERE "kind"=${kind} AND "key"=${key}`
    if (old) {
      if (stable(old.payload) !== stable(payload)) throw new DomainError('STATE_CONFLICT')
      return old
    }
    if (
      ['delivery', 'publication', 'evidence', 'review'].includes(kind) &&
      typeof payload.orderId === 'string'
    ) {
      const blocked = await tx.$queryRaw<
        unknown[]
      >`SELECT 1 FROM "PrivateLedgerEvent" c WHERE c."kind"='claim' AND c."payload"->>'orderId'=${payload.orderId} AND NOT EXISTS(SELECT 1 FROM "PrivateLedgerEvent" d WHERE d."kind"='deleted' AND d."key"=c."key") LIMIT 1`
      if (blocked.length) throw new DomainError('STATE_CONFLICT')
    }
    const [row] = await tx.$queryRaw<
      PrivateLedgerRecord[]
    >`INSERT INTO "PrivateLedgerEvent" ("sequence","id","kind","key","payload","createdAt") SELECT COALESCE(MAX("sequence"),0)+1,${randomUUID()}::uuid,${kind},${key},${stable(payload)}::jsonb,${this.now()} FROM "PrivateLedgerEvent" RETURNING *`
    return row
  }
  async watermark() {
    return this.witness.run(async (tx) => {
      const [row] = await tx.$queryRaw<
        { sequence: bigint }[]
      >`SELECT COALESCE(MAX("sequence"),0)::bigint AS sequence FROM "PrivateLedgerEvent"`
      return row.sequence.toString()
    })
  }
  async fence<T>(
    expected: string,
    work: (
      append: (key: string, payload: Record<string, unknown>) => Promise<PrivateLedgerRecord>
    ) => Promise<T>
  ) {
    return this.witness.run(async (tx) => {
      const [row] = await tx.$queryRaw<
        { sequence: bigint }[]
      >`SELECT COALESCE(MAX("sequence"),0)::bigint AS sequence FROM "PrivateLedgerEvent"`
      if (row.sequence.toString() !== expected) throw new DomainError('STATE_CONFLICT')
      return work((key, payload) => this.appendWithin(tx, 'restore', key, payload))
    })
  }

  async terminal(input: {
    scope: string
    orderId: string
    chainOrderId: string
    state: string
    height: string
    blockHash: string
  }): Promise<PrivateLedgerRecord> {
    const old = await this.find('terminal', input.scope + ':' + input.orderId)
    if (old) {
      for (const k of ['scope', 'orderId', 'chainOrderId', 'state'] as const)
        if (old.payload[k] !== input[k]) throw new DomainError('FILE_UNAVAILABLE')
      return old
    }
    try {
      return await this.append('terminal', input.scope + ':' + input.orderId, {
        ...input,
        verifiedAt: this.now().toISOString()
      })
    } catch (e) {
      if (e instanceof DomainError && e.code === 'STATE_CONFLICT') return this.terminal(input)
      throw e
    }
  }
}
