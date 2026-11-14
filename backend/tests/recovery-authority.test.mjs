import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, randomUUID, createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stable } from '../dist/web3/chain-observer.js'
const m = await import('../dist/auth/recovery-authority.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const context = 'bazaar-recovery-document-v1\n'
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bazaar-authority-')),
    keys = generateKeyPairSync('ed25519'),
    other = generateKeyPairSync('ed25519'),
    environmentId = randomUUID(),
    ledgerId = randomUUID(),
    key = join(root, 'trusted.pem'),
    checkpoint = join(root, 'checkpoint.json'),
    used = join(root, 'used')
  await writeFile(key, keys.publicKey.export({ format: 'pem', type: 'spki' }), { mode: 0o600 })
  await mkdir(used, { mode: 0o700 })
  const body = {
    version: 1,
    kind: 'witness-checkpoint',
    checkpointId: randomUUID(),
    environmentId,
    namespace: 'wallet',
    ledgerId,
    head: { version: 1, ledgerId, sequence: 2, digest: 'a'.repeat(64) }
  }
  const save = async (path, payload, k = keys.privateKey) => {
    await writeFile(
      path,
      JSON.stringify({
        payload,
        signature: sign(null, Buffer.from(context + stable(payload)), k).toString('base64')
      }),
      { mode: 0o600 }
    )
  }
  await save(checkpoint, body)
  return {
    root,
    keys,
    other,
    environmentId,
    ledgerId,
    key,
    checkpoint,
    used,
    body,
    save,
    close: () => rm(root, { recursive: true, force: true })
  }
}
test('T10 authority: pinned Ed25519 key and environment bind checkpoint; old head cannot pass floor', async () => {
  const f = await fixture()
  try {
    assert.equal(typeof m.readSignedCheckpoint, 'function')
    const o = {
      checkpointFile: f.checkpoint,
      publicKeyFile: f.key,
      environmentId: f.environmentId,
      namespace: 'wallet',
      ledgerId: f.ledgerId
    }
    const c = await m.readSignedCheckpoint(o)
    assert.equal(c.payload.head.sequence, 2)
    const guard = m.createWitnessCheckpointGuard(o, { ownerInspection: true })
    await assert.rejects(guard({ ...f.body.head, sequence: 1 }), /CHECKPOINT/)
    await guard(f.body.head)
    await assert.rejects(
      guard({ ...f.body.head, sequence: 3, digest: 'b'.repeat(64) }),
      /CHECKPOINT/
    )
    await assert.rejects(
      m.readSignedCheckpoint({ ...o, environmentId: randomUUID() }),
      /CHECKPOINT/
    )
    await f.save(f.checkpoint, f.body, f.other.privateKey)
    await assert.rejects(m.readSignedCheckpoint(o), /SIGNATURE/)
  } finally {
    await f.close()
  }
})
test('T10 authority: one-use authorization binds run/C2/config/bundle/target and refuses replay', async () => {
  const f = await fixture()
  try {
    assert.equal(typeof m.consumeRecoveryAuthorization, 'function')
    const auth = join(f.root, 'auth.json'),
      expected = {
        environmentId: f.environmentId,
        recoveryId: randomUUID(),
        checkpointHash: createHash('sha256').update('C2').digest('hex'),
        configurationVersion: 'config-2',
        bundleHash: 'b'.repeat(64),
        targetDirectory: join(f.root, 'target')
      }
    const payload = {
      ...expected,
      version: 1,
      kind: 'recovery-authorization',
      nonce: randomUUID(),
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString()
    }
    await f.save(auth, payload)
    const o = { authorizationFile: auth, publicKeyFile: f.key, usedDirectory: f.used, expected }
    await assert.rejects(
      m.consumeRecoveryAuthorization({
        ...o,
        expected: { ...expected, configurationVersion: 'config-1' }
      })
    )
    const r = await Promise.allSettled([
      m.consumeRecoveryAuthorization(o),
      m.consumeRecoveryAuthorization(o)
    ])
    assert.equal(r.filter((v) => v.status === 'fulfilled').length, 1)
    await assert.rejects(m.consumeRecoveryAuthorization(o), /CONSUMED/)
    const expired = {
      ...payload,
      nonce: randomUUID(),
      issuedAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: new Date(Date.now() - 1).toISOString()
    }
    await f.save(auth, expired)
    await assert.rejects(m.consumeRecoveryAuthorization(o), /EXPIRED/)
  } finally {
    await f.close()
  }
})
