import { createHash } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'

export interface PublicationEntry {
  version: 1
  environmentId: string
  namespace: 'wallet' | 'private-files'
  ledgerId: string
  sequence: number
  digest: string
  records: Record<string, string[]>
}
export interface PublicationOptions {
  environmentId: string
  notify?: () => void | Promise<void>
}
export const publicationTables = {
  wallet: [
    'WalletLedgerMeta',
    'WalletLedgerAccount',
    'WalletLedgerClaim',
    'WalletLedgerReservation',
    'WalletLedgerOperation',
    'WalletLedgerEvent',
    'PaymentLedgerIntent',
    'PaymentLedgerHead',
    'PaymentLedgerResolution',
    'PaymentLedgerRefundExit'
  ],
  'private-files': ['PrivateLedgerMeta', 'PrivateLedgerEvent']
} as const
const maxRows = 40000,
  maxBytes = 16 * 1024 * 1024
const fail = (): never => {
  throw new Error('PUBLICATION_OUTBOX_MISMATCH')
}
function prefix(namespace: PublicationEntry['namespace']) {
  return namespace === 'wallet'
    ? 'bazaar-security-ledger-witness-v1\n'
    : 'bazaar-private-ledger-witness-v1\n'
}
export function validatePublicationEntry(value: unknown): PublicationEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const e = value as PublicationEntry
  if (
    Object.keys(e).sort().join(',') !==
      'digest,environmentId,ledgerId,namespace,records,sequence,version' ||
    e.version !== 1 ||
    !['wallet', 'private-files'].includes(e.namespace) ||
    typeof e.environmentId !== 'string' ||
    !e.environmentId.length ||
    e.environmentId.length > 200 ||
    typeof e.ledgerId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(e.ledgerId) ||
    !Number.isSafeInteger(e.sequence) ||
    e.sequence < 0 ||
    typeof e.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(e.digest) ||
    !e.records ||
    typeof e.records !== 'object' ||
    Array.isArray(e.records) ||
    Object.keys(e.records).sort().join(',') !== [...publicationTables[e.namespace]].sort().join(',')
  )
    return fail()
  let count = 0,
    bytes = 0
  const hash = createHash('sha256').update(prefix(e.namespace))
  const records: Record<string, string[]> = {}
  for (const table of publicationTables[e.namespace]) {
    const rows = e.records[table]
    if (!Array.isArray(rows) || (count += rows.length) > maxRows) return fail()
    hash.update(table + '\n')
    let previous: string | undefined
    for (const row of rows) {
      if (
        typeof row !== 'string' ||
        (bytes += Buffer.byteLength(row)) > maxBytes ||
        (previous !== undefined && Buffer.compare(Buffer.from(previous), Buffer.from(row)) >= 0)
      )
        return fail()
      const parsed: unknown = JSON.parse(row)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail()
      hash.update(row + '\n')
      previous = row
    }
    records[table] = rows
  }
  const meta = records[publicationTables[e.namespace][0]]
  if (
    meta.length !== 1 ||
    JSON.parse(meta[0]).ledgerId !== e.ledgerId ||
    hash.digest('hex') !== e.digest
  )
    return fail()
  return { ...e, records }
}
// Count/byte limits precede pagination and fingerprinting, so oversized ledgers
// fail by budget rather than by transaction timeout or Node allocation pressure.
export async function assertPublicationBudget(
  tx: Transaction,
  namespace: PublicationEntry['namespace']
) {
  let count = 0n,
    bytes = 0n
  for (const table of publicationTables[namespace]) {
    const [r] = await tx.$queryRawUnsafe<{ count: bigint; bytes: bigint }[]>(
      `SELECT count(*)::bigint AS count, coalesce(sum(octet_length(to_jsonb(t)::text)),0)::bigint AS bytes FROM "${table}" t`
    )
    count += r.count
    bytes += r.bytes
    if (count > BigInt(maxRows) || bytes > BigInt(maxBytes)) fail()
  }
}
// Must run in the witness snapshot transaction after its UTC/ISO fingerprint.
export async function capturePublication(
  tx: Transaction,
  identity: Omit<PublicationEntry, 'version' | 'records'>
): Promise<PublicationEntry> {
  await assertPublicationBudget(tx, identity.namespace)
  const records: Record<string, string[]> = {}
  let count = 0,
    bytes = 0
  for (const table of publicationTables[identity.namespace]) {
    const result: string[] = []
    let after = ''
    for (;;) {
      // Bound the page before materializing row strings in Node.
      const page = await tx.$queryRawUnsafe<{ row: string | null; bytes: number }[]>(
        `SELECT CASE WHEN octet_length(to_jsonb(t)::text)<=$2 THEN to_jsonb(t)::text ELSE NULL END AS row,
          octet_length(to_jsonb(t)::text) AS bytes FROM "${table}" t
          WHERE to_jsonb(t)::text COLLATE "C">$1 ORDER BY to_jsonb(t)::text COLLATE "C" LIMIT 128`,
        after,
        maxBytes
      )
      if (!page.length) break
      for (const r of page) {
        if (++count > maxRows || (bytes += r.bytes) > maxBytes || r.row === null) return fail()
        result.push(r.row)
      }
      after = result[result.length - 1]
    }
    records[table] = result
  }
  return validatePublicationEntry({ version: 1, ...identity, records })
}
export async function appendPublication(tx: Transaction, entry: PublicationEntry) {
  validatePublicationEntry(entry)
  await tx.$executeRaw`INSERT INTO "LedgerPublicationOutbox" ("environmentId","namespace","ledgerId","sequence","digest","payload")
    VALUES (${entry.environmentId},${entry.namespace},${entry.ledgerId}::uuid,${entry.sequence},${entry.digest},${JSON.stringify(entry)}::jsonb)
    ON CONFLICT DO NOTHING`
  const [same] = await tx.$queryRaw<
    { ok: boolean }[]
  >`SELECT "digest"=${entry.digest} AND "payload"=${JSON.stringify(entry)}::jsonb AS ok
    FROM "LedgerPublicationOutbox" WHERE "environmentId"=${entry.environmentId} AND "namespace"=${entry.namespace}
    AND "ledgerId"=${entry.ledgerId}::uuid AND "sequence"=${entry.sequence}`
  if (!same?.ok) fail()
}
export async function verifyPublicationHead(
  tx: Transaction,
  head: { ledgerId: string; sequence: number; digest: string },
  namespace: PublicationEntry['namespace'],
  environmentId: string
) {
  // PK uniqueness plus count/min/max proves there are no holes or future rows.
  const [r] = await tx.$queryRaw<
    { count: bigint; first: bigint | null; last: bigint | null; digest: string | null }[]
  >`
    SELECT count(*)::bigint AS count,min("sequence") AS first,max("sequence") AS last,
      max(CASE WHEN "sequence"=${head.sequence} THEN "digest" END) AS digest
    FROM "LedgerPublicationOutbox" WHERE "environmentId"=${environmentId} AND "namespace"=${namespace} AND "ledgerId"=${head.ledgerId}::uuid`
  if (
    !r ||
    r.count !== BigInt(head.sequence) + 1n ||
    r.first !== 0n ||
    r.last !== BigInt(head.sequence) ||
    r.digest !== head.digest
  )
    fail()
  // Missing receipt relation also denies runtime use; never recreate it here.
  await tx.$queryRaw`SELECT 1 FROM "LedgerPublicationReceipt" LIMIT 1`
}
const columns = `o."environmentId",o."namespace",o."ledgerId",o."sequence",o."digest",o."payload"`
type Stored = {
  environmentId: string
  namespace: PublicationEntry['namespace']
  ledgerId: string
  sequence: bigint
  digest: string
  payload: unknown
}
function decode(row: Stored) {
  const entry = validatePublicationEntry(row.payload)
  if (
    entry.environmentId !== row.environmentId ||
    entry.namespace !== row.namespace ||
    entry.ledgerId !== row.ledgerId ||
    BigInt(entry.sequence) !== row.sequence ||
    entry.digest !== row.digest
  )
    return fail()
  return entry
}
export async function readPendingPublications(client: PrismaClient): Promise<PublicationEntry[]> {
  return client.$transaction(
    async (tx) => {
      const [budget] = await tx.$queryRaw<
        { count: bigint; bytes: bigint }[]
      >`SELECT count(*)::bigint AS count,
      coalesce(sum(octet_length(o."payload"::text)),0)::bigint AS bytes FROM "LedgerPublicationOutbox" o
      WHERE NOT EXISTS (SELECT 1 FROM "LedgerPublicationReceipt" r WHERE
        (r."environmentId",r."namespace",r."ledgerId",r."sequence")=(o."environmentId",o."namespace",o."ledgerId",o."sequence"))`
      if (!budget || budget.count > 40000n || budget.bytes > 64n * 1024n * 1024n) return fail()
      const rows = await tx.$queryRawUnsafe<
        Stored[]
      >(`SELECT ${columns} FROM "LedgerPublicationOutbox" o
      WHERE NOT EXISTS (SELECT 1 FROM "LedgerPublicationReceipt" r WHERE
        (r."environmentId",r."namespace",r."ledgerId",r."sequence")=(o."environmentId",o."namespace",o."ledgerId",o."sequence"))
      ORDER BY o."sequence",o."namespace",o."ledgerId",o."environmentId"`)
      return rows.map(decode)
    },
    { isolationLevel: 'RepeatableRead' }
  )
}
export async function readCommittedPublicationHeads(
  client: PrismaClient
): Promise<
  Array<{
    namespace: PublicationEntry['namespace']
    ledgerId: string
    sequence: number
    digest: string
  }>
> {
  const rows = await client.$queryRaw<
    {
      namespace: PublicationEntry['namespace']
      ledgerId: string
      sequence: bigint
      digest: string
    }[]
  >`
    SELECT DISTINCT ON ("namespace","ledgerId") "namespace","ledgerId","sequence","digest"
    FROM "LedgerPublicationOutbox" ORDER BY "namespace","ledgerId","sequence" DESC`
  return rows.map((r) => {
    const sequence = Number(r.sequence)
    if (!Number.isSafeInteger(sequence) || sequence < 0) return fail()
    return { ...r, sequence }
  })
}
export async function acknowledgePublication(
  client: PrismaClient,
  entry: PublicationEntry,
  receiptHash: string
): Promise<void> {
  validatePublicationEntry(entry)
  if (!/^[0-9a-f]{64}$/.test(receiptHash)) return fail()
  await client.$transaction(async (tx) => {
    const [stored] = await tx.$queryRaw<Stored[]>`SELECT * FROM "LedgerPublicationOutbox"
      WHERE "environmentId"=${entry.environmentId} AND "namespace"=${entry.namespace} AND "ledgerId"=${entry.ledgerId}::uuid AND "sequence"=${entry.sequence}
      AND "digest"=${entry.digest} AND "payload"=${JSON.stringify(entry)}::jsonb`
    if (!stored) return fail()
    decode(stored)
    await tx.$executeRaw`INSERT INTO "LedgerPublicationReceipt" ("environmentId","namespace","ledgerId","sequence","receiptHash")
      VALUES (${entry.environmentId},${entry.namespace},${entry.ledgerId}::uuid,${entry.sequence},${receiptHash}) ON CONFLICT DO NOTHING`
    const [receipt] = await tx.$queryRaw<
      { receiptHash: string }[]
    >`SELECT "receiptHash" FROM "LedgerPublicationReceipt"
      WHERE "environmentId"=${entry.environmentId} AND "namespace"=${entry.namespace} AND "ledgerId"=${entry.ledgerId}::uuid AND "sequence"=${entry.sequence}`
    if (receipt?.receiptHash !== receiptHash) fail()
  })
}
