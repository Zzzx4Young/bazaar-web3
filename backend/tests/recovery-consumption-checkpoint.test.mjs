import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalRecoveryAuthorizationJournal } from '../dist/auth/recovery-authorization-publication.js'
import { LocalCheckpointPublicationStore } from '../dist/auth/checkpoint-publication.js'
const mod = await import('../dist/auth/recovery-consumption-checkpoint.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
test('consumed authorizations remain pending until signed custody readback; local receipt rollback cannot revive them', async (t) => {
  assert.equal(typeof mod.PublishedRecoveryConsumptionGuard, 'function')
  const root = await mkdtemp(join(tmpdir(), 't10-consumption-checkpoint-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'store')
  await mkdir(directory, { mode: 0o700 })
  const pair = generateKeyPairSync('ed25519'),
    publicKeyFile = join(root, 'pin'),
    privateKeyFile = join(root, 'key')
  await writeFile(publicKeyFile, pair.publicKey.export({ format: 'pem', type: 'spki' }), {
    mode: 0o600
  })
  await writeFile(privateKeyFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    mode: 0o600
  })
  const store = new LocalCheckpointPublicationStore({
    directory,
    publicKeyFile,
    privateKeyFile,
    encryptionKey: randomBytes(32),
    environmentId: 'local',
    configurationVersion: 'v4'
  })
  const directoryJournal = join(root, 'journal'),
    usedDirectory = join(root, 'used')
  await mkdir(directoryJournal, { mode: 0o700 })
  await mkdir(usedDirectory, { mode: 0o700 })
  let offline = true
  const custody = {
    recover: () => store.recover(),
    publish: (r) => {
      if (offline) throw new Error('CUSTODY_OFFLINE')
      return store.publish(r)
    }
  }
  const r = {
    nonce: randomUUID(),
    authorizationHash: 'a'.repeat(64),
    recoveryId: randomUUID(),
    checkpointHash: 'b'.repeat(64),
    configurationVersion: 'v4',
    consumedAt: new Date().toISOString()
  }
  const journal = new LocalRecoveryAuthorizationJournal({
    directory: directoryJournal,
    usedDirectory,
    binding: {
      environmentId: 'local',
      recoveryId: r.recoveryId,
      checkpointHash: r.checkpointHash,
      configurationVersion: r.configurationVersion
    }
  })
  const guard = new mod.PublishedRecoveryConsumptionGuard({ journal, store: custody })
  await assert.rejects(guard.consume(r), /CUSTODY_OFFLINE/)
  assert.equal((await guard.pending()).length, 1)
  await assert.rejects(guard.consume(r), /CONSUMED/)
  offline = false
  await guard.reconcile()
  assert.equal((await guard.pending()).length, 0)
  const result = await store.recover()
  assert.equal(result.entries[0].namespace, 'recovery-authorizations')
  assert.equal(result.entries[0].ledgerId, r.nonce)
  assert.equal(result.entries[0].sequence, 0)
  assert.equal(JSON.parse(result.entries[0].records.RecoveryAuthorizationReceipt[0]).nonce, r.nonce)
  await assert.rejects(
    new mod.PublishedRecoveryConsumptionGuard({ journal, store }).consume(r),
    /CONSUMED/
  )
  // Another consumption remains pending if rename succeeds but root sync fails.
  const originalOpen = fsPromises.open
  fsPromises.open = async (...args) => {
    const f = await originalOpen(...args)
    if (args[0] === directory)
      f.sync = async () => {
        throw new Error('FSYNC_UNAVAILABLE')
      }
    return f
  }
  syncBuiltinESMExports()
  try {
    const second = { ...r, nonce: randomUUID() }
    await assert.rejects(guard.consume(second), /FSYNC_UNAVAILABLE/)
    await assert.rejects(guard.reconcile(), /FSYNC_UNAVAILABLE/)
    await assert.rejects(guard.source().pending(), /FSYNC_UNAVAILABLE/)
  } finally {
    fsPromises.open = originalOpen
    syncBuiltinESMExports()
  }
  await guard.reconcile()
  await rm(join(directoryJournal, r.nonce))
  await assert.rejects(
    new mod.PublishedRecoveryConsumptionGuard({ journal, store }).consume(r),
    /CONSUMED/
  )
  await assert.rejects(
    new mod.PublishedRecoveryConsumptionGuard({ journal, store }).reconcile(),
    /HISTORY_MISSING/
  )
})
