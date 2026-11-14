import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { mkdtemp, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { backupRoleCustody } from '../dist/auth/recovery-custody.js'
import { stable } from '../dist/web3/chain-observer.js'
import { encryptedPartHash } from '../dist/delivery-files/backup-crypto.js'
const m = await import('../dist/auth/authorized-recovery.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
test('T10 owner: consume C2/run/config bound authorization before decryption, never reuse it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bazaar-authorized-'))
  try {
    const bundle = join(root, 'bundle'),
      destination = join(root, 'destination'),
      used = join(root, 'used')
    for (const p of [bundle, destination, used]) await mkdir(p, { mode: 0o700 })
    const source = join(root, 'original'),
      publicKeyFile = join(root, 'trusted.pem'),
      authorizationFile = join(root, 'authorization'),
      checkpointFile = join(root, 'checkpoint')
    await writeFile(source, 'synthetic secret', { mode: 0o600 })
    const keys = { manifest: randomBytes(32), config: randomBytes(32) },
      pair = generateKeyPairSync('ed25519'),
      environmentId = randomUUID(),
      ledgerId = randomUUID(),
      configurationVersion = 'config-C2'
    await writeFile(publicKeyFile, pair.publicKey.export({ format: 'pem', type: 'spki' }), {
      mode: 0o600
    })
    const save = async (path, payload) =>
      writeFile(
        path,
        JSON.stringify({
          payload,
          signature: sign(
            null,
            Buffer.from('bazaar-recovery-document-v1\n' + stable(payload)),
            pair.privateKey
          ).toString('base64')
        }),
        { mode: 0o600 }
      )
    await save(checkpointFile, {
      version: 1,
      kind: 'witness-checkpoint',
      checkpointId: randomUUID(),
      environmentId,
      namespace: 'wallet',
      ledgerId,
      head: { version: 1, ledgerId, sequence: 2, digest: 'a'.repeat(64) }
    })
    await backupRoleCustody({
      directory: bundle,
      files: [{ role: 'config', name: 'runtime', keyId: 'config-C2', source }],
      keys,
      binding: { environmentId, configurationVersion }
    })
    const { readSignedCheckpoint } = await import('../dist/auth/recovery-authority.js'),
      checkpoint = { checkpointFile, publicKeyFile, environmentId, ledgerId, namespace: 'wallet' },
      verified = await readSignedCheckpoint(checkpoint),
      recoveryId = randomUUID()
    await save(authorizationFile, {
      version: 1,
      kind: 'recovery-authorization',
      environmentId,
      recoveryId,
      checkpointHash: verified.hash,
      configurationVersion,
      bundleHash: await encryptedPartHash(bundle, 'manifest'),
      targetDirectory: destination,
      nonce: randomUUID(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString()
    })
    assert.equal(typeof m.restoreAuthorizedCustody, 'function')
    const o = {
      directory: bundle,
      destination,
      keys,
      checkpoint,
      configurationVersion,
      recoveryId,
      authorizationFile,
      publicKeyFile,
      usedDirectory: used
    }
    const out = await m.restoreAuthorizedCustody(o)
    assert.equal(out.files.length, 1)
    assert.equal(out.applicationOpened, false)
    await rm(join(destination, 'config-runtime'))
    await assert.rejects(m.restoreAuthorizedCustody(o), /CONSUMED/)
    assert.deepEqual(await readdir(destination), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
