import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { LedgerWitness } from '../dist/auth/ledger-witness.js'
import { readPendingPublications } from '../dist/auth/publication-outbox.js'
import { LocalCheckpointPublicationStore } from '../dist/auth/checkpoint-publication.js'
const cli = new URL('../scripts/run-checkpoint-publisher.mjs', import.meta.url)
async function until(fn, ms = 6000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.fail('DAEMON_TEST_DEADLINE')
}
async function fixture(t, socket = true) {
  const db = await isolatedLedger(),
    root = await mkdtemp(join(tmpdir(), 'pub-daemon-'))
  const children = []
  t.after(async () => {
    for (const c of children)
      if (c.exitCode === null && !c.signalCode) {
        const end = once(c, 'exit')
        c.kill('SIGKILL')
        await end
      }
    await db.close()
    await rm(root, { recursive: true, force: true })
  })
  const pair = generateKeyPairSync('ed25519'),
    encryptionKey = randomBytes(32)
  const config = {
    environmentId: 'daemon-local',
    configurationVersion: 'daemon-v1',
    custodyDirectory: join(root, 'custody'),
    publicKeyFile: join(root, 'public.pem'),
    privateKeyFile: join(root, 'private.pem'),
    encryptionKeyFile: join(root, 'key'),
    ledgerSources: [{ namespace: 'wallet', ledgerId: db.id, urlFile: join(root, 'url') }],
    ...(socket ? { wakeSocket: join(root, 'wake.sock') } : {})
  }
  await mkdir(config.custodyDirectory, { mode: 0o700 })
  await writeFile(config.publicKeyFile, pair.publicKey.export({ type: 'spki', format: 'pem' }), {
    mode: 0o600
  })
  await writeFile(config.privateKeyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600
  })
  await writeFile(config.encryptionKeyFile, encryptionKey, { mode: 0o600 })
  await writeFile(config.ledgerSources[0].urlFile, db.url.toString(), { mode: 0o600 })
  const configFile = join(root, 'owner.json')
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 })
  const witnessDirectory = join(root, 'witness')
  await mkdir(witnessDirectory, { mode: 0o700 })
  const witness = new LedgerWitness(db.client, db.id, witnessDirectory, 'wallet', undefined, {
    environmentId: config.environmentId
  })
  await witness.initializeFresh()
  const store = new LocalCheckpointPublicationStore({
    ...config,
    directory: config.custodyDirectory,
    encryptionKey
  })
  function start(args = []) {
    const c = spawn(process.execPath, [cli.pathname, ...args], {
      env: { PATH: process.env.PATH, WEB3_PUBLICATION_CUSTODY_CONFIG_FILE: configFile },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    c.output = ''
    c.stdout.on('data', (b) => {
      c.output += b
    })
    c.stderr.on('data', (b) => {
      c.output += b
    })
    children.push(c)
    return c
  }
  const pending = () => readPendingPublications(db.client)
  const drained = () => until(async () => (await pending()).length === 0)
  const change = () =>
    witness.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId","address") VALUES (${randomUUID()}::uuid,31337,${'0x' + '1'.repeat(40)})`
    )
  async function stop(c, signal = 'SIGTERM') {
    const ended = once(c, 'exit')
    c.kill(signal)
    await ended
  }
  return { ...db, root, config, configFile, store, witness, start, pending, drained, change, stop }
}
test('spawned owner CLI starts, encrypts full records, wakes without data response and restarts with no wake', async (t) => {
  await assert.doesNotReject(() => readFile(cli), 'real publisher CLI required')
  const f = await fixture(t)
  let c = f.start()
  await f.drained()
  assert.equal((await stat(f.config.wakeSocket)).mode & 0o777, 0o600)
  await f.change()
  const socket = createConnection(f.config.wakeSocket)
  let response = ''
  socket.on('data', (b) => {
    response += b
  })
  await once(socket, 'connect')
  socket.end('{"mutation":"ignored","privateKey":"never accepted"}')
  await once(socket, 'close')
  await f.drained()
  assert.equal(response, '')
  const recovered = await f.store.recover()
  assert.equal(recovered.entries.length, 2)
  assert.equal(
    JSON.parse(recovered.entries[1].records.WalletLedgerAccount[0]).address,
    '0x' + '1'.repeat(40)
  )
  const encrypted = await readFile(
    join(f.config.custodyDirectory, 'checkpoint-000000000001', 'records.enc')
  )
  assert.equal(encrypted.includes(Buffer.from('WalletLedgerAccount')), false)
  await f.stop(c, 'SIGKILL')
  // Leave the killed daemon's socket untouched. Restart without IPC so that
  // only the durable startup scan can discover the new pending snapshot.
  delete f.config.wakeSocket
  await writeFile(f.configFile, JSON.stringify(f.config))
  await f.change()
  c = f.start()
  await f.drained()
  assert.equal((await f.store.recover()).entries.length, 3)
  await f.stop(c, 'SIGINT')
  assert.equal(c.exitCode, 0)
  assert.equal(c.output, '')
})
test('once drains and exits; occupied wake path is preserved', async (t) => {
  const f = await fixture(t)
  const c = f.start(['--once'])
  await once(c, 'exit')
  assert.equal(c.exitCode, 0)
  assert.equal((await f.pending()).length, 0)
  await writeFile(f.config.wakeSocket, 'owned-existing-file', { mode: 0o600 })
  const blocked = f.start()
  await once(blocked, 'exit')
  assert.equal(blocked.exitCode, 1)
  assert.equal(await readFile(f.config.wakeSocket, 'utf8'), 'owned-existing-file')
  assert.match(blocked.output, /^PUBLICATION_DAEMON_[A-Z_]+\n$/)
})
test(
  'real 60000ms missed-wake reconciliation keeps socketless CLI alive',
  { timeout: 70000 },
  async (t) => {
    const f = await fixture(t, false),
      c = f.start()
    await f.drained()
    const changedAt = Date.now()
    await f.change()
    await new Promise((r) => setTimeout(r, 1000))
    assert.equal((await f.pending()).length, 1, 'no wake and no accelerated timer')
    await until(async () => (await f.pending()).length === 0, 64000)
    assert.ok(Date.now() - changedAt >= 58000, 'real minute must elapse')
    assert.equal(c.exitCode, null)
    assert.equal((await f.store.recover()).entries.length, 2)
    await f.stop(c)
    assert.equal(c.exitCode, 0)
    assert.equal(c.output, '')
  }
)

test('startup failure keeps retry alive; exact runtime wake retries and logs codes only', async (t) => {
  const f = await fixture(t)
  await f.client
    .$executeRaw`ALTER TABLE "LedgerPublicationReceipt" RENAME TO "SavedPublicationReceipt"`
  const c = f.start()
  await until(() => c.output.length > 0)
  assert.equal(c.exitCode, null)
  assert.match(c.output, /^(?:[A-Z_]+\n)+$/)
  await f.client
    .$executeRaw`ALTER TABLE "SavedPublicationReceipt" RENAME TO "LedgerPublicationReceipt"`
  const { notifyPublication } = await import('../dist/auth/publication-runtime.js')
  await notifyPublication(f.config.wakeSocket)
  await f.drained()
  await f.change()
  await Promise.all(Array.from({ length: 20 }, () => notifyPublication(f.config.wakeSocket)))
  await f.drained()
  assert.equal((await f.store.recover()).entries.length, 2)
  assert.equal((await f.client.$queryRaw`SELECT * FROM "WalletLedgerAccount"`).length, 1)
  await f.stop(c)
  assert.equal(c.exitCode, 0)
  assert.match(c.output, /^(?:[A-Z_]+\n)+$/)
})
test('second daemon preserves live socket; explicit group mode requires no root', async (t) => {
  const f = await fixture(t)
  f.config.wakeSocketMode = 0o660
  await writeFile(f.configFile, JSON.stringify(f.config))
  const c = f.start()
  await f.drained()
  const inode = (await stat(f.config.wakeSocket)).ino
  assert.equal((await stat(f.config.wakeSocket)).mode & 0o777, 0o660)
  const second = f.start()
  await once(second, 'exit')
  assert.equal(second.exitCode, 1)
  assert.equal((await stat(f.config.wakeSocket)).ino, inode)
  await f.change()
  const { notifyPublication } = await import('../dist/auth/publication-runtime.js')
  await notifyPublication(f.config.wakeSocket)
  await f.drained()
  await f.stop(c)
  assert.equal(c.exitCode, 0)
})

test('wallet and private-file sources publish full snapshots into one verified custody vector', async (t) => {
  const f = await fixture(t, false)
  const privateDb = await isolatedLedger()
  t.after(() => privateDb.close())
  const sql = await readFile(new URL('../private-ledger/schema.sql', import.meta.url), 'utf8')
  for (const statement of sql.split(';').slice(0, 2))
    await privateDb.client.$executeRawUnsafe(statement)
  const id = randomUUID(),
    privateDirectory = join(f.root, 'private-witness')
  await mkdir(privateDirectory, { mode: 0o700 })
  await privateDb.client
    .$executeRaw`INSERT INTO "PrivateLedgerMeta" ("ledgerId") VALUES (${id}::uuid)`
  const witness = new LedgerWitness(
    privateDb.client,
    id,
    privateDirectory,
    'private-files',
    undefined,
    { environmentId: f.config.environmentId }
  )
  await witness.initializeFresh()
  await witness.run(
    (tx) =>
      tx.$executeRaw`INSERT INTO "PrivateLedgerEvent" ("sequence","id","kind","key","payload","createdAt") VALUES (1,${randomUUID()}::uuid,'deleted','test-asset','{"tombstone":true}'::jsonb,statement_timestamp())`
  )
  const urlFile = join(f.root, 'private-url')
  await writeFile(urlFile, privateDb.url.toString(), { mode: 0o600 })
  f.config.ledgerSources.push({ namespace: 'private-files', ledgerId: id, urlFile })
  await writeFile(f.configFile, JSON.stringify(f.config))
  const c = f.start(['--once'])
  await once(c, 'exit')
  assert.equal(c.exitCode, 0)
  assert.equal(c.output, '')
  const recovered = await f.store.recover()
  assert.equal(recovered.entries.length, 3)
  assert.equal(recovered.receipts.at(-1).checkpoint.ledgers.length, 2)
  const entry = recovered.entries.find((e) => e.namespace === 'private-files' && e.sequence === 1)
  assert.equal(JSON.parse(entry.records.PrivateLedgerEvent[0]).kind, 'deleted')
  assert.equal((await readPendingPublications(privateDb.client)).length, 0)
  assert.equal((await f.pending()).length, 0)
})
test('owner daemon includes pending consumed grants in the same wallet checkpoint vector', async (t) => {
  const f = await fixture(t, false),
    directory = join(f.root, 'authorization-journal'),
    usedDirectory = join(f.root, 'used-authorizations')
  await mkdir(directory, { mode: 0o700 })
  await mkdir(usedDirectory, { mode: 0o700 })
  const authorizationJournal = {
    directory,
    usedDirectory,
    recoveryId: randomUUID(),
    checkpointHash: 'a'.repeat(64)
  }
  const { LocalRecoveryAuthorizationJournal } =
    await import('../dist/auth/recovery-authorization-publication.js')
  const journal = new LocalRecoveryAuthorizationJournal({
    directory,
    usedDirectory,
    binding: {
      environmentId: f.config.environmentId,
      recoveryId: authorizationJournal.recoveryId,
      checkpointHash: authorizationJournal.checkpointHash,
      configurationVersion: f.config.configurationVersion
    }
  })
  const receipt = {
    nonce: randomUUID(),
    authorizationHash: 'b'.repeat(64),
    recoveryId: authorizationJournal.recoveryId,
    checkpointHash: authorizationJournal.checkpointHash,
    configurationVersion: f.config.configurationVersion,
    consumedAt: new Date().toISOString()
  }
  await journal.consume(receipt)
  f.config.authorizationJournal = authorizationJournal
  await writeFile(f.configFile, JSON.stringify(f.config))
  const child = f.start(['--once'])
  await once(child, 'exit')
  assert.equal(child.exitCode, 0, child.output)
  const material = await f.store.recover()
  assert.equal(material.entries.length, 2)
  assert.equal(material.receipts.at(-1).checkpoint.ledgers.length, 2)
  assert.ok(
    material.entries.some(
      (e) => e.namespace === 'recovery-authorizations' && e.ledgerId === receipt.nonce
    )
  )
  await assert.rejects(journal.consume(receipt), /CONSUMED/)
})
