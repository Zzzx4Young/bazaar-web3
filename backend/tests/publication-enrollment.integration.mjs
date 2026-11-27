import nodeTest from 'node:test'
import { fork } from 'node:child_process'
const test = process.env.ENROLLMENT_CRASH_CHILD === '1' ? () => {} : nodeTest
import assert from 'node:assert/strict'
import { randomUUID, generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { connect } from './helpers/database.mjs'
import { readPublicationRuntimeConfig } from '../dist/auth/publication-runtime.js'
import { LedgerWitness, requireLedgerWitness } from '../dist/auth/ledger-witness.js'
import { publishWitnessCheckpoint } from '../dist/auth/checkpoint-publisher.js'
import { readCheckpointConfig } from '../dist/auth/recovery-authority.js'
import { LocalCheckpointPublicationStore } from '../dist/auth/checkpoint-publication.js'
import { readPendingPublications, acknowledgePublication } from '../dist/auth/publication-outbox.js'
const enrollment = await import('../dist/auth/publication-enrollment.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
async function fixture(t) {
  assert.equal(
    typeof enrollment.enrollPublication,
    'function',
    'explicit enrollment interface required'
  )
  const db = await isolatedLedger(),
    root = await mkdtemp(join(tmpdir(), 't10-enrollment-'))
  t.after(async () => {
    await db.close()
    await rm(root, { recursive: true, force: true })
  })
  const sourceDirectory = join(root, 'legacy'),
    targetDirectory = join(root, 'candidate')
  const publicDirectory = join(root, 'public'),
    directory = join(root, 'custody')
  for (const p of [sourceDirectory, publicDirectory, directory]) await mkdir(p, { mode: 0o700 })
  const keys = generateKeyPairSync('ed25519'),
    publicKeyFile = join(root, 'pin.pem'),
    privateKeyFile = join(root, 'signer.pem')
  await writeFile(publicKeyFile, keys.publicKey.export({ format: 'pem', type: 'spki' }), {
    mode: 0o600
  })
  await writeFile(privateKeyFile, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    mode: 0o600
  })
  const witness = new LedgerWitness(db.client, db.id, sourceDirectory)
  await witness.initializeFresh()
  for (let i = 0; i < 2; i++)
    await witness.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
    )
  await publishWitnessCheckpoint({
    witness,
    publicDirectory,
    publicKeyFile,
    privateKeyFile,
    environmentId: 'enrollment-test',
    label: 'c2'
  })
  const checkpoint = readCheckpointConfig(join(publicDirectory, 'c2.config'), db.id, 'wallet')
  const options = {
    client: db.client,
    ledgerId: db.id,
    namespace: 'wallet',
    sourceDirectory,
    targetDirectory,
    environmentId: 'enrollment-test',
    checkpoint
  }
  const storeOptions = {
    directory,
    publicKeyFile,
    privateKeyFile,
    encryptionKey: randomBytes(32),
    environmentId: options.environmentId,
    configurationVersion: 'C5',
    baselineCheckpoints: [checkpoint]
  }
  return { ...db, root, options, checkpoint, storeOptions }
}
test('legacy nonempty C2 enrollment preserves sequence, publishes baseline, restarts and appends next sequence', async (t) => {
  const f = await fixture(t),
    before = await readFile(join(f.options.sourceDirectory, 'head.json'))
  const result = await enrollment.enrollPublication(f.options)
  assert.equal(result.status, 'candidate')
  assert.equal(result.sequence, 2)
  assert.deepEqual(await enrollment.enrollPublication(f.options), result)
  assert.deepEqual(await readFile(join(f.options.sourceDirectory, 'head.json')), before)
  assert.deepEqual(await readdir(f.options.sourceDirectory), ['head.json'])
  let rows = await readPendingPublications(f.client)
  assert.deepEqual(
    rows.map((e) => e.sequence),
    [2]
  )
  const store = new LocalCheckpointPublicationStore(f.storeOptions)
  await acknowledgePublication(f.client, rows[0], (await store.publish(rows[0])).checkpointHash)
  // Reload the pre-existing checkpoint configuration path, as the runtime does.
  const pin = readCheckpointConfig(f.checkpoint.configurationFile, f.id, 'wallet')
  assert.equal(pin.checkpointFile, f.checkpoint.checkpointFile)
  const runtimeFile = join(f.root, 'runtime.json')
  await writeFile(
    runtimeFile,
    JSON.stringify({
      environmentId: pin.environmentId,
      configurationVersion: 'C5',
      wakeSocket: join(f.root, 'wake.sock'),
      openingFile: join(f.root, 'opening.json'),
      publicKeyFile: f.storeOptions.publicKeyFile,
      recoveryRunId: randomUUID(),
      walletLedgerId: f.id
    }),
    { mode: 0o644 }
  )
  async function restart() {
    const db = await connect(f.url)
    t.after(() => db.onModuleDestroy())
    return requireLedgerWitness(db.client, {
      securityLedgerId: f.id,
      securityWitnessDirectory: result.directory,
      publication: readPublicationRuntimeConfig({
        WEB3_PUBLICATION_RUNTIME_CONFIG_FILE: runtimeFile
      })
    })
  }
  const runtime = await restart()
  await runtime.verify()
  await runtime.run(
    (tx) =>
      tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
  )
  await (await restart()).verify()
  rows = await readPendingPublications(f.client)
  assert.deepEqual(
    rows.map((e) => e.sequence),
    [3]
  )
  await store.publish(rows[0])
  assert.deepEqual(
    (await store.recover()).entries.map((e) => e.sequence),
    [2, 3]
  )
  await f.client.$executeRaw`DELETE FROM "LedgerPublicationReceipt" WHERE "sequence"=2`
  await f.client.$executeRaw`DELETE FROM "LedgerPublicationOutbox" WHERE "sequence"=2`
  await assert.rejects(runtime.verify(), /WALLET_UNAVAILABLE/)
})
for (const attack of [
  'signature',
  'head',
  'pending',
  'lock',
  'missing-outbox',
  'future-queue',
  'gap-queue',
  'conflict-queue',
  'history',
  'database'
])
  test('enrollment fails closed: ' + attack, async (t) => {
    const f = await fixture(t)
    if (attack === 'signature') {
      const d = JSON.parse(await readFile(f.checkpoint.checkpointFile, 'utf8'))
      d.signature = 'A'.repeat(86) + '=='
      await writeFile(f.checkpoint.checkpointFile, JSON.stringify(d))
    }
    if (attack === 'history') await writeFile(f.checkpoint.historyFile, '{}')
    if (attack === 'head') {
      const p = join(f.options.sourceDirectory, 'head.json'),
        h = JSON.parse(await readFile(p, 'utf8'))
      h.sequence++
      await writeFile(p, JSON.stringify(h))
    }
    if (attack === 'pending')
      await writeFile(join(f.options.sourceDirectory, 'pending.json'), '{}', { mode: 0o600 })
    if (attack === 'lock') await mkdir(join(f.options.sourceDirectory, 'lock'), { mode: 0o700 })
    if (attack === 'missing-outbox')
      await f.client
        .$executeRaw`ALTER TABLE "LedgerPublicationOutbox" RENAME TO "SavedPublicationOutbox"`
    if (attack === 'database')
      await f.client
        .$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
    if (attack === 'gap-queue' || attack === 'conflict-queue') {
      await enrollment.enrollPublication(f.options)
      if (attack === 'gap-queue') await f.client.$executeRaw`DELETE FROM "LedgerPublicationOutbox"`
      else
        await f.client.$executeRaw`UPDATE "LedgerPublicationOutbox" SET "digest"=${'b'.repeat(64)}`
    }
    if (attack === 'future-queue')
      await f.client
        .$executeRaw`INSERT INTO "LedgerPublicationOutbox" ("environmentId","namespace","ledgerId","sequence","digest","payload") VALUES ('enrollment-test','wallet',${f.id}::uuid,9,${'a'.repeat(64)},'{}'::jsonb)`
    await assert.rejects(enrollment.enrollPublication(f.options))
  })
test('conflicting enrollment baseline and partial candidate cannot be adopted', async (t) => {
  const f = await fixture(t)
  await enrollment.enrollPublication(f.options)
  await assert.rejects(enrollment.enrollPublication({ ...f.options, environmentId: 'foreign' }))
  await rm(join(f.options.targetDirectory, 'head.json'))
  await assert.rejects(enrollment.enrollPublication(f.options))
})

for (const stage of ['before-commit', 'after-commit'])
  test(
    'uncertain enrollment ' + stage + ' keeps candidate closed and source unchanged',
    async (t) => {
      const f = await fixture(t),
        original = f.client.$transaction.bind(f.client)
      const before = await readFile(join(f.options.sourceDirectory, 'head.json'))
      f.client.$transaction = async (work, options) => {
        await original(async (tx) => {
          const value = await work(tx)
          if (stage === 'before-commit') throw new Error('INJECTED_COMMIT_FAILURE')
          return value
        }, options)
        throw new Error('INJECTED_COMMIT_ACK_LOST')
      }
      await assert.rejects(enrollment.enrollPublication(f.options), /INJECTED/)
      f.client.$transaction = original
      assert.deepEqual(await readFile(join(f.options.sourceDirectory, 'head.json')), before)
      const runtime = new LedgerWitness(
        f.client,
        f.id,
        f.options.targetDirectory,
        'wallet',
        undefined,
        { environmentId: f.options.environmentId }
      )
      await assert.rejects(runtime.verify(), /WALLET_UNAVAILABLE/)
      const rows = await readPendingPublications(f.client)
      assert.equal(rows.length, stage === 'before-commit' ? 0 : 1)
      if (stage === 'after-commit') {
        await enrollment.enrollPublication(f.options)
        await runtime.verify()
      } else {
        await enrollment.enrollPublication(f.options)
        await runtime.verify()
        assert.deepEqual(
          (await readPendingPublications(f.client)).map((e) => e.sequence),
          [2]
        )
      }
    }
  )
test('active database writer prevents enrollment without waiting for its commit', async (t) => {
  const f = await fixture(t)
  let release, reached
  const wait = new Promise((r) => {
      release = r
    }),
    ready = new Promise((r) => {
      reached = r
    })
  const held = f.client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('ledger-witness-v1',0))::text`
    reached()
    await wait
  })
  await ready
  try {
    await assert.rejects(enrollment.enrollPublication(f.options), /STOPPED_WRITER_REQUIRED/)
  } finally {
    release()
    await held
  }
})

test('non-owner database connection cannot enroll even with filesystem custody', async (t) => {
  const f = await fixture(t),
    role = 'enroll_' + randomUUID().replaceAll('-', ''),
    password = randomBytes(24).toString('hex')
  let restricted
  try {
    await f.client.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER PASSWORD '${password}'`
    )
    const url = new URL(f.url)
    url.username = role
    url.password = password
    restricted = await connect(url)
    await assert.rejects(
      enrollment.enrollPublication({ ...f.options, client: restricted.client }),
      /OWNER_RECOVERY_REQUIRED/
    )
  } finally {
    await restricted?.onModuleDestroy()
    await f.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
  }
})

if (process.env.ENROLLMENT_CRASH_CHILD === '1')
  process.once('message', async (options) => {
    const db = await connect(new URL(options.url))
    const original = db.client.$transaction.bind(db.client)
    db.client.$transaction = async (work, txOptions) => {
      const result = await original(async (tx) => {
        const value = await work(tx)
        if (options.stage === 'before-commit') {
          process.send({ stage: options.stage })
          await new Promise(() => {})
        }
        return value
      }, txOptions)
      process.send({ stage: options.stage })
      await new Promise(() => {})
      return result
    }
    try {
      await enrollment.enrollPublication({ ...options.enrollment, client: db.client })
    } catch (e) {
      process.send({ error: e.message })
    }
  })
for (const stage of ['before-commit', 'after-commit'])
  test('SIGKILL ' + stage + ' leaves enrollment candidate protected', async (t) => {
    const f = await fixture(t)
    const child = fork(new URL('./publication-enrollment.integration.mjs', import.meta.url), [], {
      env: { PATH: process.env.PATH, ENROLLMENT_CRASH_CHILD: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    })
    try {
      const reached = new Promise((resolve, reject) => {
        child.once('message', (m) => (m.stage === stage ? resolve() : reject(new Error(m.error))))
        child.once('error', reject)
        child.once('exit', () => reject(new Error('crash child exited early')))
      })
      const options = { ...f.options }
      delete options.client
      child.send({ stage, url: f.url.toString(), enrollment: options })
      await reached
      const exited = new Promise((r) => child.once('exit', r))
      child.kill('SIGKILL')
      await exited
      assert.equal(
        (await readPendingPublications(f.client)).length,
        stage === 'after-commit' ? 1 : 0
      )
      const runtime = new LedgerWitness(
        f.client,
        f.id,
        f.options.targetDirectory,
        'wallet',
        undefined,
        { environmentId: f.options.environmentId }
      )
      await assert.rejects(runtime.verify(), /WALLET_UNAVAILABLE/)
      if (stage === 'after-commit') {
        await enrollment.enrollPublication(f.options)
        await runtime.verify()
      } else {
        await enrollment.enrollPublication(f.options)
        await runtime.verify()
      }
    } finally {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL')
    }
  })
test('retired legacy witness cannot read or write after nonempty enrollment, even before first new mutation', async (t) => {
  const f = await fixture(t)
  await enrollment.enrollPublication(f.options)
  const legacy = new LedgerWitness(f.client, f.id, f.options.sourceDirectory)
  await assert.rejects(legacy.verify(), /WALLET_UNAVAILABLE/)
  await assert.rejects(
    legacy.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
    ),
    /WALLET_UNAVAILABLE/
  )
  const staged = new LedgerWitness(f.client, f.id, f.options.targetDirectory, 'wallet', undefined, {
    environmentId: f.options.environmentId
  })
  await staged.verify()
})
test('legacy transaction waiting on enrollment cannot use its earlier RepeatableRead snapshot to skip publication', async (t) => {
  const f = await fixture(t),
    other = await connect(f.url),
    original = f.client.$transaction.bind(f.client)
  let release, ready
  const hold = new Promise((r) => {
      release = r
    }),
    atCommit = new Promise((r) => {
      ready = r
    })
  f.client.$transaction = (work, options) =>
    original(async (tx) => {
      const out = await work(tx)
      ready()
      await hold
      return out
    }, options)
  let enroll, write
  try {
    enroll = enrollment.enrollPublication(f.options)
    await atCommit
    const legacy = new LedgerWitness(other.client, f.id, f.options.sourceDirectory)
    write = legacy
      .run(
        (tx) =>
          tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error })
      )
    const deadline = Date.now() + 3000
    let blocked = false
    while (Date.now() < deadline) {
      const [row] = await f.client
        .$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS blocked`
      if (row.blocked) {
        blocked = true
        break
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    assert.equal(blocked, true, 'legacy request reached blocked advisory SELECT')
    release()
    await enroll
    const result = await write
    assert.equal(result.error?.code, 'WALLET_UNAVAILABLE')
    const [{ n }] = await f.client.$queryRaw`SELECT count(*)::int AS n FROM "WalletLedgerAccount"`
    assert.equal(n, 2)
    const staged = new LedgerWitness(
      f.client,
      f.id,
      f.options.targetDirectory,
      'wallet',
      undefined,
      { environmentId: f.options.environmentId }
    )
    await staged.verify()
  } finally {
    release()
    await enroll?.catch(() => {})
    await write
    f.client.$transaction = original
    await other.onModuleDestroy()
  }
})
