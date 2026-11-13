#!/usr/bin/env node
// Owner-only provisioning, not a repair/rebaseline command. Never loads .env.
import { readFile } from 'node:fs/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { LedgerWitness } from '../dist/auth/ledger-witness.js'
if (process.argv.length !== 3 || process.argv[2] !== '--confirm-empty-independent-ledger')
  throw new Error('Only --confirm-empty-independent-ledger is supported; no force or repair option')
const file = process.env.WEB3_SECURITY_LEDGER_OWNER_URL_FILE,
  id = process.env.WEB3_SECURITY_LEDGER_ID,
  root = process.env.WEB3_SECURITY_WITNESS_DIR
if (!file || !id || !root)
  throw new Error('Owner URL file, ledger ID and protected witness directory required')
const url = new URL((await readFile(file, 'utf8')).trim())
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !/^\/wallet_security(?:_[a-z0-9]+)*$/.test(url.pathname)
)
  throw new Error('Refusing to enrol a business database')
const db = new DatabaseService(url.toString())
try {
  await db.onModuleInit()
  const [role] = await db.client
    .$queryRaw`SELECT has_table_privilege(current_user,format('%I.%I',current_schema(),'WalletLedgerMeta'),'UPDATE') AS owner`
  if (role?.owner !== true) throw new Error('Ledger owner credentials required')
  await new LedgerWitness(db.client, id, root).initializeFresh()
  console.log(JSON.stringify({ event: 'empty_ledger_witness_initialized', ledgerId: id }))
} finally {
  await db.onModuleDestroy()
}
