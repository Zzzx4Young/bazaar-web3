import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { grantWalletLedger } from './wallet-ledger-grants.mjs'

if (process.argv.length !== 3 || process.argv[2] !== '--confirm-independent-ledger')
  throw new Error('Use --confirm-independent-ledger with a dedicated wallet_security database')
const file = process.env.WEB3_SECURITY_LEDGER_OWNER_URL_FILE
const role = process.env.WEB3_SECURITY_LEDGER_RUNTIME_ROLE
const id = process.env.WEB3_SECURITY_LEDGER_ID
if (!file || !role || !id || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))
  throw new Error('Explicit ledger owner URL file, runtime role and ledger ID required')
const url = new URL((await readFile(file, 'utf8')).trim())
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/wallet_security(?:_[a-z0-9]+)*$/.test(url.pathname))
  throw new Error('Refusing to provision a business database')
const schema = url.searchParams.get('schema') ?? 'public'
if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid ledger schema')
const db = new DatabaseService(url.toString())
try {
  await db.onModuleInit()
  const sql = await readFile(new URL('../security-ledger/schema.sql', import.meta.url), 'utf8')
  await db.client.$transaction(async tx => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    for (const statement of sql.split(';').filter(s => s.trim())) await tx.$executeRawUnsafe(statement)
    await tx.$executeRaw`INSERT INTO "WalletLedgerMeta" ("ledgerId", "recoveryEpoch")
      VALUES (${id}::uuid, ${randomUUID()}::uuid)`
  })
  await grantWalletLedger(db.client, schema, role)
  console.log('Independent wallet ledger provisioned; existing ledgers are never reset by this command.')
} finally { await db.onModuleDestroy() }
