#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { PrivateLifecycleLedger } from '../dist/delivery-files/deletion-ledger.js'
import { protectedText } from '../dist/delivery-files/lifecycle-config.js'
if (process.argv.length !== 3 || process.argv[2] !== '--confirm-independent-private-ledger')
  throw new Error('Explicit independent private-ledger confirmation required')
const owner = process.env.PRIVATE_LEDGER_OWNER_URL_FILE,
  id = process.env.PRIVATE_LEDGER_ID,
  root = process.env.PRIVATE_LEDGER_WITNESS_DIR,
  role = process.env.PRIVATE_LEDGER_RUNTIME_ROLE
if (!owner || !id || !root || !role || !/^[a-z][a-z0-9_]{0,62}$/.test(role))
  throw new Error(
    'Protected ownerURL,ledgerID,witness root and pre-existing restricted role required'
  )
const url = new URL(protectedText(owner)),
  schema = url.searchParams.get('schema') ?? 'private_lifecycle'
if (
  !/^[a-z][a-z0-9_]{0,62}$/.test(schema) ||
  !/^\/(wallet_security|private_lifecycle)(?:_[a-z0-9]+)*$/.test(url.pathname)
)
  throw new Error('Refusing a business database')
url.searchParams.set('schema', schema)
const db = new DatabaseService(url.toString())
try {
  await db.onModuleInit()
  await db.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  await db.client.$transaction(async (tx) => {
    const sql = await readFile(new URL('../private-ledger/schema.sql', import.meta.url), 'utf8')
    for (const s of sql.split(';').filter((s) => s.trim())) await tx.$executeRawUnsafe(s)
    await tx.$executeRaw`INSERT INTO "PrivateLedgerMeta" ("ledgerId") VALUES (${id}::uuid)`
    await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`)
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
    await tx.$executeRawUnsafe(
      `REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM PUBLIC, "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT SELECT ON "${schema}"."PrivateLedgerMeta", "${schema}"."PrivateLedgerEvent" TO "${role}"`
    )
    await tx.$executeRawUnsafe(`GRANT INSERT ON "${schema}"."PrivateLedgerEvent" TO "${role}"`)
    await tx.$executeRawUnsafe(
      `GRANT SELECT, INSERT ON "${schema}"."LedgerPublicationOutbox", "${schema}"."LedgerPublicationReceipt" TO "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT SELECT ON SEQUENCE "${schema}"."LedgerPublicationFence" TO "${role}"`
    )
  })
  await new PrivateLifecycleLedger(db.client, id, root).witness.initializeFresh()
  console.log(JSON.stringify({ event: 'independent_private_ledger_created', ledgerId: id }))
} finally {
  await db.onModuleDestroy()
}
