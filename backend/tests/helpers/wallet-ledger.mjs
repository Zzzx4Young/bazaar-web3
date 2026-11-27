import {LedgerWitness,registerLedgerWitness} from '../../dist/auth/ledger-witness.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect, testUrl } from './database.mjs'
import { PostgresWalletSecurityLedger } from '../../dist/auth/postgres-wallet-security-ledger.js'

export async function isolatedLedger(options = {}) {
  const url = testUrl()
  const schema = `wl_${randomUUID().replaceAll('-', '')}`
  const admin = await connect(url)
  await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  const privateUrl = new URL(url)
  privateUrl.searchParams.set('schema', schema)
  const db = await connect(privateUrl)
  const sql = await readFile(new URL('../../security-ledger/schema.sql', import.meta.url), 'utf8')
  for (const statement of sql.split(';').filter((s) => s.trim()))
    await db.client.$executeRawUnsafe(statement)
  const id = randomUUID(), epoch = randomUUID()
  await db.client.$executeRaw`INSERT INTO "WalletLedgerMeta" ("singleton", "ledgerId", "recoveryEpoch")
    VALUES (true, ${id}::uuid, ${epoch}::uuid)`
  const witness = options.witnessDirectory ? new LedgerWitness(db.client,id,options.witnessDirectory) : null
  if (witness) { await witness.initializeFresh(); registerLedgerWitness(db.client,witness) }
  return { witness, url: privateUrl, client: db.client, ledger: new PostgresWalletSecurityLedger(db.client, id), id, epoch,
    async close() {
      await db.onModuleDestroy()
      await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
      await admin.onModuleDestroy()
    } }
}
