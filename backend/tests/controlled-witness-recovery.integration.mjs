import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, generateKeyPairSync, sign, createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fork } from 'node:child_process'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { isolatedPrivateLedger } from './helpers/private-ledger.mjs'
import { stable } from '../dist/web3/chain-observer.js'
import { createWitnessCheckpointGuard } from '../dist/auth/recovery-authority.js'
import { LedgerWitness } from '../dist/auth/ledger-witness.js'
const recovery = await import('../dist/auth/controlled-witness-recovery.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const head = (root) => readFile(join(root, 'head.json'), 'utf8').then(JSON.parse)
async function roots() {
  const source = await mkdtemp(join(tmpdir(), 'bazaar-t10-media-')),
    custody = await mkdtemp(join(tmpdir(), 'bazaar-t10-custody-')),
    destination = await mkdtemp(join(tmpdir(), 'bazaar-t10-candidate-'))
  const keys = generateKeyPairSync('ed25519'),
    publicKeyFile = join(custody, 'trusted.pem'),
    environmentId = randomUUID()
  await writeFile(publicKeyFile, keys.publicKey.export({ format: 'pem', type: 'spki' }), {
    mode: 0o600
  })
  return {
    source,
    custody,
    destination,
    keys,
    publicKeyFile,
    environmentId,
    close: () =>
      Promise.all(
        [source, custody, destination].map((p) => rm(p, { recursive: true, force: true }))
      )
  }
}
async function checkpoint(r, t, pending, extras = {}) {
  const path = join(r.custody, 'checkpoint.json')
  const payload = {
    version: 1,
    kind: 'witness-checkpoint',
    checkpointId: randomUUID(),
    environmentId: r.environmentId,
    ledgerId: t.id,
    namespace: 'wallet',
    head: await head(r.source),
    ...(pending ? { pending } : {}),
    ...extras
  }
  await writeFile(
    path,
    JSON.stringify({
      payload,
      signature: sign(
        null,
        Buffer.from('bazaar-recovery-document-v1\n' + stable(payload)),
        r.keys.privateKey
      ).toString('base64')
    }),
    { mode: 0o600 }
  )
  return path
}
async function stage(t, r, path, outcome = 'head', target = join(r.destination, 'candidate')) {
  assert.equal(
    typeof recovery.stageWitnessRecovery,
    'function',
    'controlled owner staging required'
  )
  return recovery.stageWitnessRecovery({
    client: t.client,
    ledgerId: t.id,
    namespace: 'wallet',
    sourceDirectory: r.source,
    checkpointFile: path,
    targetDirectory: target,
    outcome,
    environmentId: r.environmentId,
    publicKeyFile: r.publicKeyFile
  })
}
test('T10 media: witness rollback isolates identity; latest third checkpoint stages a fresh root without changing original', async () => {
  const r = await roots(),
    t = await isolatedLedger({ witnessDirectory: r.source })
  try {
    const old = await readFile(join(r.source, 'head.json'))
    await t.witness.run(
      (tx) => tx.$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch"=${randomUUID()}::uuid`
    )
    const path = await checkpoint(r, t)
    await writeFile(join(r.source, 'head.json'), old)
    await assert.rejects(t.ledger.recoveryEpoch(), /WALLET_UNAVAILABLE/)
    const out = await stage(t, r, path)
    assert.equal(out.status, 'candidate')
    assert.equal(out.applicationOpened, false)
    assert.deepEqual(await readFile(join(r.source, 'head.json')), old)
    await new LedgerWitness(t.client, t.id, out.directory).verify()
    assert.equal((await stage(t, r, path)).recoveryId, out.recoveryId)
  } finally {
    await t.close()
    await r.close()
  }
})
test('T10 media: jointly rolled-back DB and witness match locally but fail against latest independent checkpoint', async () => {
  const r = await roots(),
    t = await isolatedLedger({ witnessDirectory: r.source })
  try {
    const old = await readFile(join(r.source, 'head.json'))
    await t.witness.run(
      (tx) => tx.$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch"=${randomUUID()}::uuid`
    )
    const path = await checkpoint(r, t)
    await t.client.$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch"=${t.epoch}::uuid`
    await writeFile(join(r.source, 'head.json'), old)
    await t.witness.verify() // Deliberately exposes the freshness limit of the pair alone.
    const guard = createWitnessCheckpointGuard(
      {
        checkpointFile: path,
        publicKeyFile: r.publicKeyFile,
        environmentId: r.environmentId,
        namespace: 'wallet',
        ledgerId: t.id
      },
      { ownerInspection: true }
    )
    await assert.rejects(
      new LedgerWitness(t.client, t.id, r.source, 'wallet', guard).verify(),
      /WALLET_UNAVAILABLE/
    )
    await assert.rejects(stage(t, r, path), /CHECKPOINT_MISMATCH/)
    await assert.rejects(stage(t, r, join(r.custody, 'missing.json')))
  } finally {
    await t.close()
    await r.close()
  }
})
for (const at of ['before-commit', 'after-commit'])
  test(
    'T10 pending: real SIGKILL ' + at + ' only permits exact owner-selected outcome',
    async () => {
      const r = await roots(),
        t = await isolatedLedger({ witnessDirectory: r.source })
      let child
      try {
        child = fork(new URL('./helpers/ledger-witness-process.mjs', import.meta.url), [], {
          env: { PATH: process.env.PATH, TEST_LEDGER_URL: t.url.toString() },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        })
        const reached = new Promise((yes, no) => {
          child.on('message', (m) =>
            m.stage === at ? yes() : no(new Error(m.error ?? 'unexpected stage'))
          )
          child.on('error', no)
          child.on('exit', () => no(new Error('early child exit')))
        })
        child.send({
          stage: at,
          id: t.id,
          root: r.source,
          change: {
            operationId: randomUUID(),
            operation: 'bind',
            accountId: randomUUID(),
            chainId: 11155111,
            expectedRecoveryEpoch: t.epoch,
            expectedRevision: '0',
            expectedBindingVersion: 0,
            address: '0x' + 'a'.repeat(40),
            payout: null,
            requestHash: 'a'.repeat(64)
          }
        })
        await reached
        const pending = JSON.parse(await readFile(join(r.source, 'pending.json'), 'utf8')),
          path = await checkpoint(r, t, pending)
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGKILL')
        await exited
        const saved = await readFile(join(r.source, 'pending.json'))
        await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
        const chosen = at === 'before-commit' ? 'before' : 'after'
        await assert.rejects(
          stage(t, r, path, chosen === 'before' ? 'after' : 'before'),
          /CHECKPOINT_MISMATCH/
        )
        const out = await stage(t, r, path, chosen)
        assert.deepEqual(await readFile(join(r.source, 'pending.json')), saved)
        assert.ok((await stat(join(r.source, 'lock'))).isDirectory())
        await new LedgerWitness(t.client, t.id, out.directory).verify()
        await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
      } finally {
        if (child?.exitCode === null && !child.signalCode) child.kill('SIGKILL')
        await t.close()
        await r.close()
      }
    }
  )
test('T10 media: private lifecycle witness rollback also isolates deletion history', async () => {
  const t = await isolatedPrivateLedger()
  try {
    const old = await readFile(join(t.root, 'head.json'))
    await t.ledger.append('claim', randomUUID(), { orderId: randomUUID() })
    await writeFile(join(t.root, 'head.json'), old)
    await assert.rejects(t.ledger.records(), /WALLET_UNAVAILABLE/)
  } finally {
    await t.close()
  }
})

test('T10 review: owner locks inspect the latest committed state, not the earlier authority-query snapshot', async () => {
  const r = await roots(),
    t = await isolatedLedger({ witnessDirectory: r.source })
  const { connect } = await import('./helpers/database.mjs'),
    other = await connect(t.url)
  const transaction = t.client.$transaction.bind(t.client)
  try {
    const path = await checkpoint(r, t)
    t.client.$transaction = (work, options) =>
      transaction(async (tx) => {
        const query = tx.$queryRaw.bind(tx)
        let changed = false
        tx.$queryRaw = async (...args) => {
          const out = await query(...args)
          if (!changed && String(args[0]?.[0]).includes('FROM pg_class')) {
            changed = true
            await other.client
              .$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch"=${randomUUID()}::uuid`
          }
          return out
        }
        return work(tx)
      }, options)
    await assert.rejects(stage(t, r, path), /CHECKPOINT_MISMATCH/)
  } finally {
    t.client.$transaction = transaction
    await other.onModuleDestroy()
    await t.close()
    await r.close()
  }
})

test('T10 review: authenticated immutable C2 history allows real append but rejects a relabeled C1 head', async () => {
  const r = await roots(),
    t = await isolatedLedger({ witnessDirectory: r.source })
  try {
    const c1 = await head(r.source)
    await t.witness.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO "WalletLedgerEvent" ("operationId","phase","payload") VALUES (${randomUUID()}::uuid,'prepared','{}')`
    )
    const { captureCheckpointHistory } = await import('../dist/auth/checkpoint-history.js')
    const proof = await t.witness.withOwnerRecoverySnapshot((digest, tx) =>
      captureCheckpointHistory(tx, 'wallet', t.id)
    )
    const raw = JSON.stringify(proof),
      historyFile = join(r.custody, 'history.json')
    await writeFile(historyFile, raw, { mode: 0o600 })
    const path = await checkpoint(r, t, undefined, {
      historyHash: createHash('sha256').update(raw).digest('hex')
    })
    const guard = createWitnessCheckpointGuard(
      {
        checkpointFile: path,
        publicKeyFile: r.publicKeyFile,
        environmentId: r.environmentId,
        namespace: 'wallet',
        ledgerId: t.id,
        historyFile
      },
      { ownerInspection: true }
    )
    const guarded = new LedgerWitness(t.client, t.id, r.source, 'wallet', guard)
    await guarded.run(
      (tx) =>
        tx.$executeRaw`INSERT INTO "WalletLedgerEvent" ("operationId","phase","payload") VALUES (${randomUUID()}::uuid,'prepared','{}')`
    )
    await guarded.verify()
    await t.client.$executeRaw`DELETE FROM "WalletLedgerEvent"`
    await writeFile(join(r.source, 'head.json'), JSON.stringify({ ...c1, sequence: 99 }), {
      mode: 0o600
    })
    // Fingerprint matches old DB and forged larger sequence, but C2 history is absent.
    await assert.rejects(guarded.verify(), /WALLET_UNAVAILABLE/)
  } finally {
    await t.close()
    await r.close()
  }
})

test('T10 review: normal API cannot drop controlled recovery policy by omitting Web3 flags', async () => {
  const { retentionFixture } = await import('./helpers/retention.mjs'),
    t = await retentionFixture()
  const { readConfig } = await import('../dist/config.js'),
    { createApp } = await import('../dist/app.js')
  let app
  try {
    await t.db.client.privateRecoveryState.create({
      data: {
        singleton: true,
        runId: randomUUID(),
        backupId: randomUUID(),
        downloadEpoch: randomUUID(),
        status: 'active',
        checks: { database: t.db.url.pathname, controlledRecovery: true }
      }
    })
    const config = readConfig({ DATABASE_URL: t.db.url.toString() })
    await assert.rejects(async () => {
      app = await createApp(config, false, { logRequest: false })
    }, /CONTROLLED_CHECKPOINT_CONFIG_REQUIRED/)
  } finally {
    await app?.close()
    await t.close()
  }
})

test('T10: a dot-prefixed child path cannot masquerade as an independent candidate directory', async () => {
  const r = await roots(),
    t = await isolatedLedger({ witnessDirectory: r.source })
  try {
    const parent = join(r.source, '..nested')
    await (await import('node:fs/promises')).mkdir(parent, { mode: 0o700 })
    const path = await checkpoint(r, t)
    await assert.rejects(
      stage(t, r, path, 'head', join(parent, 'candidate')),
      /INDEPENDENT_CUSTODY_REQUIRED/
    )
  } finally {
    await t.close()
    await r.close()
  }
})
