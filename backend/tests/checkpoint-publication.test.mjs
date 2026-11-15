import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { generateKeyPairSync, randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publicationTables } from '../dist/auth/publication-outbox.js'
const mod = await import('../dist/auth/checkpoint-publication.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 't10-publication-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'custody')
  await mkdir(directory, { mode: 0o700 })
  const pair = generateKeyPairSync('ed25519'),
    publicKeyFile = join(root, 'pin.pem'),
    privateKeyFile = join(root, 'authority.pem')
  await writeFile(publicKeyFile, pair.publicKey.export({ format: 'pem', type: 'spki' }), {
    mode: 0o600
  })
  await writeFile(privateKeyFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    mode: 0o600
  })
  const options = {
      directory,
      publicKeyFile,
      privateKeyFile,
      encryptionKey: randomBytes(32),
      environmentId: 'isolated-t10',
      configurationVersion: 'C4'
    },
    ledgerId = randomUUID()
  const entry = (sequence, namespace = 'wallet', id = ledgerId) => {
    const records = Object.fromEntries(publicationTables[namespace].map((table) => [table, []]))
    records[publicationTables[namespace][0]] = [JSON.stringify({ ledgerId: id, change: sequence })]
    const h = createHash('sha256').update(
      namespace === 'wallet'
        ? 'bazaar-security-ledger-witness-v1\n'
        : 'bazaar-private-ledger-witness-v1\n'
    )
    for (const [table, rows] of Object.entries(records)) {
      h.update(table + '\n')
      for (const row of rows) h.update(row + '\n')
    }
    return {
      version: 1,
      environmentId: options.environmentId,
      namespace,
      ledgerId: id,
      sequence,
      digest: h.digest('hex'),
      records
    }
  }
  assert.equal(typeof mod.LocalCheckpointPublicationStore, 'function')
  return { root, options, entry, store: new mod.LocalCheckpointPublicationStore(options) }
}
test('encrypted snapshots precede signed vector; lost receipt retry returns identical checkpoint', async (t) => {
  const { options, entry, store } = await fixture(t),
    zero = entry(0),
    one = entry(1),
    other = entry(0, 'private-files', randomUUID())
  const a = await store.publish(zero),
    b = await store.publish(one),
    retry = await new mod.LocalCheckpointPublicationStore(options).publish(one)
  assert.deepEqual(retry, b)
  const c = await store.publish(other)
  assert.equal(b.checkpoint.parentHash, a.checkpointHash)
  assert.equal(c.checkpoint.parentHash, b.checkpointHash)
  assert.equal(c.checkpoint.ledgers.length, 2)
  assert.equal(c.checkpoint.configurationVersion, 'C4')
  const r = await store.recover()
  assert.equal(r.entries.length, 3)
  assert.deepEqual(r.entries[1], one)
  for (const folder of await readdir(options.directory)) {
    const body = await readFile(join(options.directory, folder, 'records.enc'))
    assert.equal(body.includes(Buffer.from(one.records.WalletLedgerMeta[0])), false)
  }
})
test('conflicting sequence, skipped sequence and foreign environment cannot advance custody', async (t) => {
  const { entry, store } = await fixture(t)
  await store.publish(entry(0))
  await assert.rejects(store.publish(entry(2)), /PUBLICATION_GAP/)
  await store.publish(entry(1))
  await assert.rejects(
    store.publish({ ...entry(1), digest: 'f'.repeat(64) }),
    /PUBLICATION_CONFLICT|OUTBOX_MISMATCH/
  )
  await assert.rejects(
    store.publish({ ...entry(2), environmentId: 'other' }),
    /PUBLICATION_ENVIRONMENT/
  )
  assert.equal((await store.recover()).entries.length, 2)
})
test('missing bytes, altered signature, predecessor, configuration and ciphertext fail closed', async (t) => {
  for (const attack of ['missing', 'signature', 'parent', 'configuration', 'ciphertext'])
    await t.test(attack, async (t) => {
      const { entry, store, options } = await fixture(t)
      await store.publish(entry(0))
      await store.publish(entry(1))
      const directory = join(options.directory, 'checkpoint-000000000001')
      if (attack === 'missing') await rm(join(directory, 'records.enc'))
      else if (attack === 'ciphertext')
        await writeFile(join(directory, 'records.enc'), randomBytes(50))
      else {
        const file = join(directory, 'checkpoint.json'),
          doc = JSON.parse(await readFile(file, 'utf8'))
        if (attack === 'signature') doc.signature = 'A'.repeat(86) + '=='
        if (attack === 'parent') doc.payload.parentHash = 'f'.repeat(64)
        if (attack === 'configuration') doc.payload.configurationVersion = 'wrong'
        await writeFile(file, JSON.stringify(doc))
      }
      await assert.rejects(store.recover())
      await assert.rejects(store.publish(entry(2)))
    })
})
test('pre-pinned key, encryption and concurrent publishers prevent false confirmation or forks', async (t) => {
  const { entry, store, options, root } = await fixture(t)
  const r = await Promise.all([
    store.publish(entry(0)),
    new mod.LocalCheckpointPublicationStore(options).publish(entry(0))
  ])
  assert.equal(r[0].checkpointHash, r[1].checkpointHash)
  const wrong = generateKeyPairSync('ed25519'),
    file = join(root, 'wrong.pem')
  await writeFile(file, wrong.publicKey.export({ format: 'pem', type: 'spki' }), { mode: 0o600 })
  await assert.rejects(
    new mod.LocalCheckpointPublicationStore({ ...options, publicKeyFile: file }).recover()
  )
  await assert.rejects(
    new mod.LocalCheckpointPublicationStore({
      ...options,
      encryptionKey: randomBytes(32)
    }).recover()
  )
})
test('full record digest must match ledger witness; opaque self-declared digests are rejected', async (t) => {
  const { entry, store } = await fixture(t),
    e = entry(0)
  e.records.WalletLedgerMeta[0] = '{"changed":true}'
  await assert.rejects(store.publish(e), /OUTBOX_MISMATCH/)
})

test('persistent custody-root fsync failure prevents idempotent acknowledgement', async (t) => {
  const { entry, store, options } = await fixture(t),
    original = fsPromises.open
  let syncs = 0
  fsPromises.open = async (...args) => {
    const f = await original(...args)
    if (args[0] === options.directory) {
      f.sync = async () => {
        syncs++
        throw new Error('FSYNC_UNAVAILABLE')
      }
    }
    return f
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(store.publish(entry(0)), /FSYNC_UNAVAILABLE/)
    await assert.rejects(store.publish(entry(0)), /FSYNC_UNAVAILABLE/)
    assert.equal(syncs, 2)
  } finally {
    fsPromises.open = original
    syncBuiltinESMExports()
  }
  assert.equal((await store.publish(entry(0))).checkpoint.ordinal, 0)
})
test('concurrent retry establishes its own durable root sync before returning winner receipt', async (t) => {
  const { entry, store, options } = await fixture(t),
    original = fsPromises.open
  let syncs = 0,
    release,
    paused
  const wait = new Promise((r) => {
      release = r
    }),
    reached = new Promise((r) => {
      paused = r
    })
  fsPromises.open = async (...args) => {
    const f = await original(...args)
    if (args[0] === options.directory) {
      const sync = f.sync.bind(f)
      f.sync = async () => {
        syncs++
        if (syncs === 1) {
          paused()
          await wait
        }
        await sync()
      }
    }
    return f
  }
  syncBuiltinESMExports()
  const first = store.publish(entry(0))
  try {
    await reached
    const second = await new mod.LocalCheckpointPublicationStore(options).publish(entry(0))
    assert.equal(syncs, 2)
    release()
    assert.equal((await first).checkpointHash, second.checkpointHash)
  } finally {
    release()
    await first.catch(() => undefined)
    fsPromises.open = original
    syncBuiltinESMExports()
  }
})
