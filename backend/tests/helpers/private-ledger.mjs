import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, testUrl } from './database.mjs'
export async function isolatedPrivateLedger() {
  const { PrivateLifecycleLedger } = await import('../../dist/delivery-files/deletion-ledger.js')
  const url = new URL(testUrl()),
    schema = 'pl_' + randomUUID().replaceAll('-', ''),
    admin = await connect(url)
  await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  url.searchParams.set('schema', schema)
  const db = await connect(url),
    root = await mkdtemp(join(tmpdir(), 'bazaar-private-ledger-')),
    id = randomUUID()
  try {
    for (const s of (
      await readFile(new URL('../../private-ledger/schema.sql', import.meta.url), 'utf8')
    )
      .split(';')
      .filter((s) => s.trim()))
      await db.client.$executeRawUnsafe(s)
    await db.client.$executeRaw`INSERT INTO "PrivateLedgerMeta" ("ledgerId") VALUES (${id}::uuid)`
    const ledger = new PrivateLifecycleLedger(db.client, id, root)
    await ledger.witness.initializeFresh()
    return {
      url,
      db,
      ledger,
      root,
      id,
      async close() {
        await db.onModuleDestroy()
        await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
        await admin.onModuleDestroy()
        await rm(root, { recursive: true, force: true })
      }
    }
  } catch (e) {
    await db.onModuleDestroy()
    await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.onModuleDestroy()
    await rm(root, { recursive: true, force: true })
    throw e
  }
}
