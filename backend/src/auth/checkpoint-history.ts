import { createHash } from 'node:crypto'
import type { Transaction } from '../database/transaction.js'
export type HistoryNamespace = 'wallet' | 'private-files'
const immutable = {
  wallet: [
    'WalletLedgerClaim',
    'WalletLedgerEvent',
    'PaymentLedgerIntent',
    'PaymentLedgerResolution',
    'PaymentLedgerRefundExit'
  ],
  'private-files': ['PrivateLedgerEvent']
} as const
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export interface CheckpointHistory {
  version: 1
  namespace: HistoryNamespace
  ledgerId: string
  metadataDigest: string
  rows: Record<string, string[]>
}
async function rows(tx: Transaction, table: string) {
  const result: string[] = []
  let after = ''
  for (;;) {
    const page = await tx.$queryRawUnsafe<{ row: string }[]>(
      `SELECT to_jsonb(t)::text AS row FROM "${table}" t WHERE to_jsonb(t)::text COLLATE "C">$1 ORDER BY to_jsonb(t)::text COLLATE "C" LIMIT 128`,
      after
    )
    if (!page.length) break
    for (const r of page) result.push(hash(table + '\n' + r.row))
    if (result.length > 40000) throw new Error('CHECKPOINT_HISTORY_BUDGET')
    after = page.at(-1)!.row
  }
  return result.sort()
}
async function meta(tx: Transaction, namespace: HistoryNamespace) {
  const table = namespace === 'wallet' ? 'WalletLedgerMeta' : 'PrivateLedgerMeta'
  const r = await tx.$queryRawUnsafe<{ row: string }[]>(
    `SELECT to_jsonb(t)::text AS row FROM "${table}" t WHERE "singleton"=true`
  )
  if (r.length !== 1) throw new Error('CHECKPOINT_HISTORY_MISMATCH')
  return hash(table + '\n' + r[0].row)
}
// Called under the witness owner EXCLUSIVE snapshot or the normal witness
// transaction after fingerprint has fixed PostgreSQL UTC/ISO serialization.
export async function captureCheckpointHistory(
  tx: Transaction,
  namespace: HistoryNamespace,
  ledgerId: string
): Promise<CheckpointHistory> {
  const contents: Record<string, string[]> = {}
  let count = 0
  for (const table of immutable[namespace]) {
    contents[table] = await rows(tx, table)
    count += contents[table].length
  }
  if (count > 40000) throw new Error('CHECKPOINT_HISTORY_BUDGET')
  return {
    version: 1,
    namespace,
    ledgerId,
    metadataDigest: await meta(tx, namespace),
    rows: contents
  }
}
export async function verifyCheckpointHistory(
  tx: Transaction,
  proof: unknown,
  namespace: HistoryNamespace,
  ledgerId: string
) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof))
    throw new Error('CHECKPOINT_HISTORY_MISMATCH')
  const p = proof as CheckpointHistory
  if (
    Object.keys(p).sort().join(',') !== 'ledgerId,metadataDigest,namespace,rows,version' ||
    p.version !== 1 ||
    p.namespace !== namespace ||
    p.ledgerId !== ledgerId ||
    !p.rows ||
    Object.keys(p.rows).sort().join(',') !== [...immutable[namespace]].sort().join(',') ||
    p.metadataDigest !== (await meta(tx, namespace))
  )
    throw new Error('CHECKPOINT_HISTORY_MISMATCH')
  let total = 0
  for (const table of immutable[namespace]) {
    const required = p.rows[table]
    if (
      !Array.isArray(required) ||
      required.some((x) => typeof x !== 'string' || !/^[a-f0-9]{64}$/.test(x)) ||
      (total += required.length) > 40000 ||
      new Set(required).size !== required.length
    )
      throw new Error('CHECKPOINT_HISTORY_MISMATCH')
    const actual = new Set(await rows(tx, table))
    if (required.some((h) => !actual.has(h))) throw new Error('CHECKPOINT_HISTORY_MISMATCH')
  }
}
