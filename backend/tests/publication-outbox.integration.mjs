import nodeTest from 'node:test'
import { setImmediate } from 'node:timers'
const test = process.env.PUBLICATION_CRASH_CHILD === '1' ? () => {} : nodeTest
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fork } from 'node:child_process'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { connect, testUrl } from './helpers/database.mjs'
import { LedgerWitness, registerLedgerWitness } from '../dist/auth/ledger-witness.js'
const outbox = await import('../dist/auth/publication-outbox.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const environmentId = 'publication-test'
async function fixture({ namespace = 'wallet', notify } = {}) {
  assert.equal(
    typeof outbox.readPendingPublications,
    'function',
    'durable publication outbox required'
  )
  let t
  if (namespace === 'wallet') t = await isolatedLedger()
  else {
    const url = new URL(testUrl()),
      schema = 'po_' + randomUUID().replaceAll('-', '')
    const admin = await connect(url)
    await admin.client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    url.searchParams.set('schema', schema)
    const db = await connect(url),
      id = randomUUID()
    for (const s of (
      await readFile(new URL('../private-ledger/schema.sql', import.meta.url), 'utf8')
    )
      .split(';')
      .filter((s) => s.trim()))
      await db.client.$executeRawUnsafe(s)
    await db.client.$executeRaw`INSERT INTO "PrivateLedgerMeta" ("ledgerId") VALUES (${id}::uuid)`
    t = {
      client: db.client,
      id,
      url,
      async close() {
        await db.onModuleDestroy()
        await admin.client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
        await admin.onModuleDestroy()
      }
    }
  }
  const root = await mkdtemp(join(tmpdir(), 'publication-outbox-'))
  const witness = new LedgerWitness(t.client, t.id, root, namespace, undefined, {
    environmentId,
    notify
  })
  try {
    await witness.initializeFresh()
  } catch (e) {
    await t.close()
    await rm(root, { recursive: true, force: true })
    throw e
  }
  return {
    ...t,
    root,
    witness,
    async close() {
      await t.close()
      await rm(root, { recursive: true, force: true })
    }
  }
}
const pending = (t) => outbox.readPendingPublications(t.client)
async function change(t) {
  return t.witness.run(
    (tx) =>
      tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
  )
}
function digest(entry) {
  const hash = createHash('sha256').update(
    entry.namespace === 'wallet'
      ? 'bazaar-security-ledger-witness-v1\n'
      : 'bazaar-private-ledger-witness-v1\n'
  )
  for (const [table, rows] of Object.entries(entry.records)) {
    hash.update(table + '\n')
    for (const row of rows) hash.update(row + '\n')
  }
  return hash.digest('hex')
}
test('genesis and changed full snapshots are atomic, canonical, ordered, and reads create nothing', async () => {
  const t = await fixture()
  try {
    const [genesis] = await pending(t)
    assert.equal(genesis.sequence, 0)
    assert.equal(genesis.environmentId, environmentId)
    assert.equal(genesis.ledgerId, t.id)
    assert.equal(digest(genesis), genesis.digest)
    await t.witness.verify()
    assert.equal((await pending(t)).length, 1)
    await change(t)
    const entries = await pending(t)
    assert.deepEqual(
      entries.map((e) => e.sequence),
      [0, 1]
    )
    assert.equal(entries[1].records.WalletLedgerAccount.length, 1)
    assert.equal(Object.keys(entries[1].records).length, 10)
    const [row] = await t.client
      .$queryRaw`SELECT to_jsonb(t)::text AS row FROM "WalletLedgerAccount" t`
    assert.equal(entries[1].records.WalletLedgerAccount[0], row.row)
    assert.equal(digest(entries[1]), entries[1].digest)
    assert.equal(
      JSON.parse(await readFile(join(t.root, 'head.json'), 'utf8')).digest,
      entries[1].digest
    )
  } finally {
    await t.close()
  }
})
test('rollback creates neither ledger mutation nor queued publication', async () => {
  const t = await fixture()
  try {
    await assert.rejects(
      t.witness.run(async (tx) => {
        await tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
        throw new Error('abort')
      })
    )
    assert.equal((await pending(t)).length, 1)
    assert.deepEqual(await t.client.$queryRaw`SELECT * FROM "WalletLedgerAccount"`, [])
    await t.witness.verify()
  } finally {
    await t.close()
  }
})
test('notify failures and never resolving callbacks cannot undo or block committed queue', async () => {
  let calls = 0
  const t = await fixture({
    notify: () => {
      calls++
      if (calls % 2) throw new Error('offline')
      return Promise.reject(new Error('offline'))
    }
  })
  try {
    await change(t)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 2)
    assert.equal((await pending(t)).length, 2)
    const next = new LedgerWitness(t.client, t.id, t.root, 'wallet', undefined, {
      environmentId,
      notify: () => new Promise(() => {})
    })
    await next.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
    )
    assert.equal((await pending(t)).length, 3)
  } finally {
    await t.close()
  }
})
test('ack is append-only exact idempotency; altered payload, digest, identity and receipt are denied', async () => {
  const t = await fixture()
  try {
    const [entry] = await pending(t),
      receipt = 'a'.repeat(64)
    await outbox.acknowledgePublication(t.client, entry, receipt)
    await outbox.acknowledgePublication(t.client, entry, receipt)
    assert.deepEqual(await pending(t), [])
    await assert.rejects(outbox.acknowledgePublication(t.client, entry, 'b'.repeat(64)))
    for (const modified of [
      { ...entry, digest: 'b'.repeat(64) },
      { ...entry, environmentId: 'other' },
      { ...entry, records: {} },
      { ...entry, sequence: 1 }
    ])
      await assert.rejects(outbox.acknowledgePublication(t.client, modified, receipt))
    await change(t)
    assert.deepEqual(
      (await pending(t)).map((e) => e.sequence),
      [1]
    )
    await t.witness.verify()
  } finally {
    await t.close()
  }
})
test('private deletion events publish full private snapshots', async () => {
  const t = await fixture({ namespace: 'private-files' })
  try {
    await t.witness.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO "PrivateLedgerEvent" ("sequence","id","kind","key","payload","createdAt") VALUES (1,${randomUUID()}::uuid,'deleted','asset','{"tombstone":true}'::jsonb,statement_timestamp())`
    )
    const entries = await pending(t)
    assert.deepEqual(
      entries.map((e) => e.sequence),
      [0, 1]
    )
    assert.deepEqual(Object.keys(entries[1].records), ['PrivateLedgerMeta', 'PrivateLedgerEvent'])
    assert.equal(JSON.parse(entries[1].records.PrivateLedgerEvent[0]).kind, 'deleted')
    assert.equal(digest(entries[1]), entries[1].digest)
  } finally {
    await t.close()
  }
})
test('publication opt-in persists, cannot be silently removed or changed, and rejects implicit legacy enrollment', async () => {
  const t = await fixture()
  try {
    await assert.rejects(new LedgerWitness(t.client, t.id, t.root).verify(), /WALLET_UNAVAILABLE/)
    await assert.rejects(
      new LedgerWitness(t.client, t.id, t.root, 'wallet', undefined, {
        environmentId: 'other'
      }).verify(),
      /WALLET_UNAVAILABLE/
    )
    await new LedgerWitness(t.client, t.id, t.root, 'wallet', undefined, { environmentId }).verify()
  } finally {
    await t.close()
  }
  const legacy = await isolatedLedger(),
    root = await mkdtemp(join(tmpdir(), 'legacy-outbox-'))
  try {
    await new LedgerWitness(legacy.client, legacy.id, root).initializeFresh()
    await assert.rejects(
      new LedgerWitness(legacy.client, legacy.id, root, 'wallet', undefined, {
        environmentId
      }).verify(),
      /WALLET_UNAVAILABLE/
    )
  } finally {
    await legacy.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('missing or truncated outbox fails closed; restoring exact rows resumes without resealing', async () => {
  const t = await fixture()
  try {
    await change(t)
    const saved = await t.client
      .$queryRaw`SELECT * FROM "LedgerPublicationOutbox" ORDER BY "sequence"`
    await t.client.$executeRaw`DELETE FROM "LedgerPublicationOutbox" WHERE "sequence"=0`
    await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
    const row = saved[0]
    await t.client
      .$executeRaw`INSERT INTO "LedgerPublicationOutbox" ("environmentId","namespace","ledgerId","sequence","digest","payload") VALUES (${row.environmentId},${row.namespace},${row.ledgerId}::uuid,${row.sequence},${row.digest},${JSON.stringify(row.payload)}::jsonb)`
    await t.witness.verify()
    await t.client
      .$executeRaw`ALTER TABLE "LedgerPublicationOutbox" RENAME TO "SavedPublicationOutbox"`
    await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
    await t.client
      .$executeRaw`ALTER TABLE "SavedPublicationOutbox" RENAME TO "LedgerPublicationOutbox"`
    await t.witness.verify()
    assert.equal((await pending(t)).length, 2)
  } finally {
    await t.close()
  }
})
test('snapshot count budget fails closed and rolls back ledger plus publication', async () => {
  const t = await fixture()
  try {
    await assert.rejects(
      t.witness.run(
        (tx) =>
          tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") SELECT gen_random_uuid(),31337 FROM generate_series(1,40000)`
      ),
      /WALLET_UNAVAILABLE/
    )
    assert.deepEqual(await t.client.$queryRaw`SELECT * FROM "WalletLedgerAccount"`, [])
    assert.equal((await pending(t)).length, 1)
    await t.witness.verify()
  } finally {
    await t.close()
  }
})
test('committed heads include acknowledged entries and pending sorts sequence numerically', async () => {
  const t = await fixture()
  try {
    for (let i = 0; i < 11; i++) await change(t)
    const entries = await pending(t)
    assert.deepEqual(
      entries.map((e) => e.sequence),
      Array.from({ length: 12 }, (_, i) => i)
    )
    assert.deepEqual(await outbox.readCommittedPublicationHeads(t.client), [
      { namespace: 'wallet', ledgerId: t.id, sequence: 11, digest: entries[11].digest }
    ])
    for (const e of entries) await outbox.acknowledgePublication(t.client, e, 'a'.repeat(64))
    assert.deepEqual(await pending(t), [])
    assert.deepEqual(await outbox.readCommittedPublicationHeads(t.client), [
      { namespace: 'wallet', ledgerId: t.id, sequence: 11, digest: entries[11].digest }
    ])
    await t.witness.verify()
  } finally {
    await t.close()
  }
})
test('actual binding prepare and commit enqueue separate sequence snapshots; retry and reads do not', async () => {
  const t = await fixture()
  try {
    registerLedgerWitness(t.client, t.witness)
    const c = {
      operationId: randomUUID(),
      operation: 'bind',
      accountId: randomUUID(),
      chainId: 31337,
      expectedRecoveryEpoch: t.epoch,
      expectedRevision: '0',
      expectedBindingVersion: 0,
      address: '0x' + '1'.repeat(40),
      payout: null,
      requestHash: 'a'.repeat(64)
    }
    await t.ledger.prepare(c)
    await t.ledger.commit(c.operationId)
    const entries = await pending(t)
    assert.deepEqual(
      entries.map((e) => e.sequence),
      [0, 1, 2]
    )
    assert.equal(JSON.parse(entries[1].records.WalletLedgerOperation[0]).status, 'prepared')
    assert.equal(JSON.parse(entries[2].records.WalletLedgerOperation[0]).status, 'committed')
    assert.equal(JSON.parse(entries[2].records.WalletLedgerClaim[0]).accountId, c.accountId)
    await t.ledger.commit(c.operationId)
    await t.ledger.read(c.accountId, 31337)
    assert.deepEqual(await pending(t), entries)
  } finally {
    await t.close()
  }
})
test('refund exit append queues exact immutable full rows including bigint precision', async () => {
  const t = await fixture()
  try {
    const id = randomUUID(),
      order = randomUUID(),
      listing = randomUUID(),
      h = '0x' + '1'.repeat(64)
    await t.witness.run(async (tx) => {
      await tx.$executeRaw`INSERT INTO "PaymentLedgerIntent" ("id","orderId","listingId","stockId","scope","digest","termsHash","recoveryEpoch","permit") VALUES (${id}::uuid,${order}::uuid,${listing}::uuid,${h},'test',${h},${h},${t.epoch}::uuid,'{}'::jsonb)`
      await tx.$executeRaw`INSERT INTO "PaymentLedgerRefundExit" ("scope","chainId","escrow","chainOrderId","orderId","listingId","stockId","generation","nextGeneration","fundedIntentId","recoveryEpoch","basisHash","evidence","refundHeight","refundBlockHash","refundTxHash","refundLogIndex","finalizedHeight","finalizedHash") VALUES ('test',31337,${'0x' + '1'.repeat(40)},${h},${order}::uuid,${listing}::uuid,${h},'0','1',${id}::uuid,${t.epoch}::uuid,${'a'.repeat(64)},'{}'::jsonb,9007199254740993,${h},${h},0,9007199254740994,${h})`
    })
    const entries = await pending(t),
      rows = entries[1].records.PaymentLedgerRefundExit
    assert.equal(rows.length, 1)
    assert.ok(rows[0].includes('9007199254740993'))
    const [actual] = await t.client
      .$queryRaw`SELECT to_jsonb(t)::text AS row FROM "PaymentLedgerRefundExit" t`
    assert.equal(rows[0], actual.row)
    assert.equal(digest(entries[1]), entries[1].digest)
  } finally {
    await t.close()
  }
})
test('snapshot byte budget rolls back without enqueue or ambiguity marker', async () => {
  const t = await fixture()
  try {
    await assert.rejects(
      t.witness.run(
        (tx) =>
          tx.$executeRaw`INSERT INTO "WalletLedgerEvent" ("operationId","phase","payload") VALUES (${randomUUID()}::uuid,'prepared',jsonb_build_object('huge',repeat('x',16777216)))`
      ),
      /WALLET_UNAVAILABLE/
    )
    assert.equal((await pending(t)).length, 1)
    assert.deepEqual(await t.client.$queryRaw`SELECT * FROM "WalletLedgerEvent"`, [])
    await t.witness.verify()
  } finally {
    await t.close()
  }
})
test('missing receipt table denies reads and mutations without runtime DDL', async () => {
  const t = await fixture()
  try {
    await t.client
      .$executeRaw`ALTER TABLE "LedgerPublicationReceipt" RENAME TO "SavedPublicationReceipt"`
    await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
    await assert.rejects(change(t), /WALLET_UNAVAILABLE/)
    await assert.rejects(pending(t))
    const [r] = await t.client
      .$queryRaw`SELECT to_regclass('"LedgerPublicationReceipt"')::text AS name`
    assert.equal(r.name, null)
    await t.client
      .$executeRaw`ALTER TABLE "SavedPublicationReceipt" RENAME TO "LedgerPublicationReceipt"`
    await t.witness.verify()
  } finally {
    await t.close()
  }
})
test('owner checkpoint publisher keeps strict signed head compatible with publication marker', async () => {
  const t = await fixture()
  try {
    const { publishWitnessCheckpoint } = await import('../dist/auth/checkpoint-publisher.js')
    const publicDirectory = join(t.root, 'public'),
      privateKeyFile = join(t.root, 'signer.pem'),
      publicKeyFile = join(publicDirectory, 'key.pem')
    await mkdir(publicDirectory, { mode: 0o755 })
    const keys = generateKeyPairSync('ed25519')
    await writeFile(privateKeyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600
    })
    await writeFile(publicKeyFile, keys.publicKey.export({ type: 'spki', format: 'pem' }), {
      mode: 0o644
    })
    await publishWitnessCheckpoint({
      witness: t.witness,
      environmentId,
      publicDirectory,
      privateKeyFile,
      publicKeyFile,
      label: 'outbox-genesis'
    })
    const document = JSON.parse(
      await readFile(join(publicDirectory, 'outbox-genesis.json'), 'utf8')
    )
    assert.deepEqual(Object.keys(document.payload.head).sort(), [
      'digest',
      'ledgerId',
      'sequence',
      'version'
    ])
    assert.equal(
      JSON.parse(await readFile(join(t.root, 'head.json'), 'utf8')).publicationEnvironmentId,
      environmentId
    )
  } finally {
    await t.close()
  }
})
test('restricted runtime can append, inspect and acknowledge but cannot rewrite publication or receipts', async () => {
  const t = await fixture(),
    admin = await connect(testUrl())
  const role = 'por_' + randomUUID().replaceAll('-', ''),
    password = randomBytes(24).toString('hex')
  let runtime,
    created = false
  try {
    await admin.client.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
    )
    created = true
    const { grantWalletLedger } = await import('../scripts/wallet-ledger-grants.mjs')
    const { assertWalletLedgerGrants } = await import('../dist/auth/wallet-ledger-grants.js')
    await grantWalletLedger(t.client, t.url.searchParams.get('schema'), role)
    const url = new URL(t.url)
    url.username = role
    url.password = password
    runtime = await connect(url)
    await assertWalletLedgerGrants(runtime.client, true)
    const witness = new LedgerWitness(runtime.client, t.id, t.root, 'wallet', undefined, {
      environmentId
    })
    await change({ witness })
    const entries = await outbox.readPendingPublications(runtime.client)
    assert.deepEqual(
      entries.map((e) => e.sequence),
      [0, 1]
    )
    await outbox.acknowledgePublication(runtime.client, entries[0], 'a'.repeat(64))
    for (const table of ['LedgerPublicationOutbox', 'LedgerPublicationReceipt']) {
      for (const sql of [
        `UPDATE "${table}" SET "sequence"=1`,
        `DELETE FROM "${table}"`,
        `TRUNCATE "${table}"`
      ])
        await assert.rejects(runtime.client.$executeRawUnsafe(sql), /permission denied/)
    }
    await witness.verify()
  } finally {
    await runtime?.onModuleDestroy()
    await t.close()
    if (created) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})
// This file also runs as its own isolated crash child. It never loads .env.
if (process.env.PUBLICATION_CRASH_CHILD === '1')
  process.once('message', async (m) => {
    const db = await connect(new URL(process.env.TEST_LEDGER_URL))
    try {
      const original = db.client.$transaction.bind(db.client)
      db.client.$transaction = async (work, options) => {
        const value = await original(async (tx) => {
          const result = await work(tx)
          if (m.stage === 'before-commit') {
            process.send({ stage: m.stage })
            await new Promise(() => {})
          }
          return result
        }, options)
        if (m.stage === 'after-commit') {
          process.send({ stage: m.stage })
          await new Promise(() => {})
        }
        return value
      }
      await change({
        client: db.client,
        witness: new LedgerWitness(db.client, m.id, m.root, 'wallet', undefined, { environmentId })
      })
    } catch (e) {
      process.send({ error: e.message })
    }
  })
for (const stage of ['before-commit', 'after-commit'])
  test(
    'SIGKILL ' + stage + ' preserves atomic ledger/outbox commit boundary',
    { skip: process.env.PUBLICATION_CRASH_CHILD === '1' },
    async () => {
      const t = await fixture()
      let child
      try {
        child = fork(new URL('./publication-outbox.integration.mjs', import.meta.url), [], {
          env: {
            PATH: process.env.PATH,
            PUBLICATION_CRASH_CHILD: '1',
            TEST_LEDGER_URL: t.url.toString()
          },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        })
        const reached = new Promise((resolve, reject) => {
          child.once('message', (m) => (m.stage === stage ? resolve() : reject(new Error(m.error))))
          child.once('error', reject)
          child.once('exit', () => reject(new Error('crash child exited early')))
        })
        child.send({ stage, id: t.id, root: t.root })
        await reached
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGKILL')
        await exited
        assert.equal((await pending(t)).length, stage === 'after-commit' ? 2 : 1)
        assert.equal(
          (await t.client.$queryRaw`SELECT * FROM "WalletLedgerAccount"`).length,
          stage === 'after-commit' ? 1 : 0
        )
        assert.equal(
          JSON.parse(await readFile(join(t.root, 'pending.json'), 'utf8')).after.sequence,
          1
        )
        await rm(join(t.root, 'lock'), { recursive: true })
        await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
      } finally {
        if (child?.exitCode === null && !child.signalCode) child.kill('SIGKILL')
        await t.close()
      }
    }
  )
