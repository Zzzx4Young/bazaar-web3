// Explicit additive owner operation, never a business migration or recovery reset.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { grantWalletLedger } from './wallet-ledger-grants.mjs'

async function definition(tx, relation) {
  const columns = await tx.$queryRaw`
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull, a.attidentity::text AS attidentity, a.attgenerated::text AS attgenerated,
      a.attcollation::text AS collation,
      pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = to_regclass(${relation}) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`
  const constraints = await tx.$queryRaw`
    SELECT contype::text AS type, pg_get_constraintdef(oid, false) AS definition,
      convalidated, condeferrable, condeferred, connoinherit, conislocal
    FROM pg_constraint WHERE conrelid = to_regclass(${relation})
    ORDER BY contype, pg_get_constraintdef(oid, false)`
  const indexes = await tx.$queryRaw`
    SELECT indisunique, indisprimary, indisvalid, indisready, indimmediate,
      indkey::text AS keys, indclass::text AS classes, indcollation::text AS collations,
      indoption::text AS options, pg_get_expr(indexprs, indrelid) AS expressions,
      pg_get_expr(indpred, indrelid) AS predicate
    FROM pg_index WHERE indrelid = to_regclass(${relation}) ORDER BY indkey::text`
  return JSON.stringify({ columns, constraints, indexes })
}

if (process.argv.length !== 3 || process.argv[2] !== '--confirm-independent-ledger')
  throw new Error('Use --confirm-independent-ledger with a dedicated wallet_security database')
const file = process.env.WEB3_SECURITY_LEDGER_OWNER_URL_FILE
const role = process.env.WEB3_SECURITY_LEDGER_RUNTIME_ROLE
const id = process.env.WEB3_SECURITY_LEDGER_ID
if (!file || !role || !id || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))
  throw new Error('Explicit ledger owner URL file, runtime role and ledger ID required')
if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid ledger runtime role')
const url = new URL((await readFile(file, 'utf8')).trim())
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/wallet_security(?:_[a-z0-9]+)*$/.test(url.pathname))
  throw new Error('Refusing to upgrade a business database')
const schema = url.searchParams.get('schema') ?? 'public'
if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid ledger schema')
const db = new DatabaseService(url.toString())
try {
  await db.onModuleInit()
  const sql = await readFile(new URL('../security-ledger/refund-schema.sql', import.meta.url), 'utf8')
  await db.client.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", pg_catalog`)
    // Serialize additive reruns and pin the existing identity without changing it.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`refund-ledger:${schema}`}, 0))::text`
    await tx.$executeRawUnsafe(`LOCK TABLE "${schema}"."WalletLedgerMeta" IN SHARE MODE`)
    const meta = await tx.$queryRawUnsafe(`SELECT "ledgerId" FROM "${schema}"."WalletLedgerMeta"`)
    if (meta.length !== 1 || meta[0].ledgerId.toLowerCase() !== id.toLowerCase())
      throw new Error('Independent ledger identity mismatch')
    const relation = `"${schema}"."PaymentLedgerRefundExit"`
    const [existing] = await tx.$queryRaw`SELECT to_regclass(${relation})::text AS name`
    if (!existing.name) {
      for (const statement of sql.split(';').filter(s => s.trim())) await tx.$executeRawUnsafe(statement)
    }
    await tx.$executeRawUnsafe(`LOCK TABLE ${relation} IN ACCESS EXCLUSIVE MODE`)
    const [shape] = await tx.$queryRaw`
      SELECT c.relkind::text AS kind, c.relpersistence::text AS persistence,
        c.relrowsecurity, c.relforcerowsecurity,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = c.oid AND NOT tgisinternal) AS triggers,
        EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class = c.oid) AS rules,
        EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = c.oid OR inhparent = c.oid) AS inheritance
      FROM pg_class c WHERE c.oid = to_regclass(${relation})`
    if (!shape || shape.kind !== 'r' || shape.persistence !== 'p' ||
      shape.relrowsecurity || shape.relforcerowsecurity || shape.triggers || shape.rules || shape.inheritance)
      throw new Error('Malformed refund ledger table definition')
    // PostgreSQL forbids a temporary table FK to a permanent intent table.
    // Build and drop a private reference within this transaction instead.
    const referenceName = `_refund_expected_${randomUUID().replaceAll('-', '')}`
    const referenceRelation = `"${schema}"."${referenceName}"`
    const reference = sql.replace('CREATE TABLE "PaymentLedgerRefundExit"', `CREATE TABLE ${referenceRelation}`)
    for (const statement of reference.split(';').filter(s => s.trim())) await tx.$executeRawUnsafe(statement)
    if (await definition(tx, relation) !== await definition(tx, referenceRelation))
      throw new Error('Malformed refund ledger definition or constraints')
    await tx.$executeRawUnsafe(`DROP TABLE ${referenceRelation}`)
    // Reuse the provisioner's complete privilege boundary in this same transaction.
    await grantWalletLedger({ $transaction: work => work(tx) }, schema, role)
  }, { timeout: 30_000 })
  console.log('Independent refund ledger verified and granted; ledger identity and history preserved.')
} finally { await db.onModuleDestroy() }
