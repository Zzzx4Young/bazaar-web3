import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, randomUUID, randomBytes } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  chmod,
  link,
  open
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { encryptBackupPart, decryptBackupPart } from '../dist/delivery-files/backup-crypto.js'
import { stable } from '../dist/web3/chain-observer.js'
import { consumeRecoveryAuthorization } from '../dist/auth/recovery-authority.js'
const publication = await import('../dist/auth/recovery-authorization-publication.js').catch(
  (e) => {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
    return {}
  }
)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'consumption-publication-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const usedDirectory = join(root, 'receipts'),
    directory = join(root, 'custody')
  await mkdir(usedDirectory, { mode: 0o700 })
  await mkdir(directory, { mode: 0o700 })
  const keys = generateKeyPairSync('ed25519')
  const expected = {
    environmentId: 'isolated-test',
    recoveryId: randomUUID(),
    checkpointHash: 'a'.repeat(64),
    configurationVersion: 'config-4',
    bundleHash: 'b'.repeat(64),
    targetDirectory: join(root, 'restored')
  }
  const payload = {
    ...expected,
    version: 1,
    kind: 'recovery-authorization',
    nonce: randomUUID(),
    issuedAt: '2026-11-15T00:00:00.000Z',
    expiresAt: '2026-11-15T00:02:00.000Z'
  }
  const authorizationFile = join(root, 'authorization.json'),
    publicKeyFile = join(root, 'authority.pem')
  const save = async (key = keys.privateKey) =>
    writeFile(
      authorizationFile,
      JSON.stringify({
        payload,
        signature: sign(
          null,
          Buffer.from('bazaar-recovery-document-v1\n' + stable(payload)),
          key
        ).toString('base64')
      }),
      { mode: 0o600 }
    )
  await save()
  await writeFile(publicKeyFile, keys.publicKey.export({ type: 'spki', format: 'pem' }), {
    mode: 0o600
  })
  const options = { directory, usedDirectory, binding: expected }
  const args = {
    authorizationFile,
    publicKeyFile,
    usedDirectory,
    expected,
    now: () => new Date('2026-11-15T00:01:00.000Z')
  }
  const key = randomBytes(32),
    plaintext = join(root, 'decrypted')
  await encryptBackupPart(
    root,
    expected.recoveryId,
    'credentials',
    key,
    Readable.from(['sensitive custody'])
  )
  const restore = async (consumptionGuard) => {
    await consumeRecoveryAuthorization({ ...args, consumptionGuard })
    await decryptBackupPart(root, expected.recoveryId, 'credentials', key, plaintext)
  }
  return {
    restore,
    plaintext,
    root,
    directory,
    usedDirectory,
    payload,
    options,
    args,
    save,
    journal: () => new publication.LocalRecoveryAuthorizationJournal(options)
  }
}

test('retained consumption root prevents replay after original receipt directory rollback', async (t) => {
  const f = await fixture(t)
  assert.equal(typeof publication.LocalRecoveryAuthorizationJournal, 'function')
  await f.restore(f.journal())
  assert.equal(await readFile(f.plaintext, 'utf8'), 'sensitive custody')
  await rm(f.plaintext)
  const local = JSON.parse(await readFile(join(f.usedDirectory, f.payload.nonce), 'utf8'))
  assert.equal(local.nonce, f.payload.nonce)
  const snapshots = await f.journal().readReceipts()
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].environmentId, 'isolated-test')
  assert.equal(snapshots[0].nonce, f.payload.nonce)
  assert.equal(snapshots[0].consumedAt, '2026-11-15T00:01:00.000Z')
  assert.match(snapshots[0].authorizationHash, /^[a-f0-9]{64}$/)
  await rm(f.usedDirectory, { recursive: true })
  await mkdir(f.usedDirectory, { mode: 0o700 })
  await assert.rejects(f.restore(f.journal()), /CONSUMED/)
  assert.deepEqual(await readdir(f.usedDirectory), [])
  await assert.rejects(readFile(f.plaintext), { code: 'ENOENT' })
})

test('guard failure prevents local receipt and continuation to decrypt', async (t) => {
  const f = await fixture(t)
  let decrypted = false
  await assert.rejects(
    (async () => {
      await consumeRecoveryAuthorization({
        ...f.args,
        consumptionGuard: {
          consume: async () => {
            throw new Error('external unavailable')
          }
        }
      })
      decrypted = true
    })(),
    /external unavailable/
  )
  assert.equal(decrypted, false)
  assert.deepEqual(await readdir(f.usedDirectory), [])
})

test('separate journal instances admit exactly one concurrent consumption', async (t) => {
  const f = await fixture(t)
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      consumeRecoveryAuthorization({ ...f.args, consumptionGuard: f.journal() })
    )
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  for (const r of results.filter((r) => r.status === 'rejected'))
    assert.match(r.reason.message, /CONSUMED/)
  assert.equal((await f.journal().readReceipts()).length, 1)
})

test('lost acknowledgement burns reservation without allowing decrypt or retry', async (t) => {
  const f = await fixture(t),
    journal = f.journal()
  await assert.rejects(
    f.restore({
      consume: async (receipt) => {
        await journal.consume(receipt)
        throw new Error('ack lost')
      }
    }),
    /ack lost/
  )
  await assert.rejects(readFile(f.plaintext), { code: 'ENOENT' })
  assert.deepEqual(await readdir(f.usedDirectory), [])
  await assert.rejects(
    consumeRecoveryAuthorization({ ...f.args, consumptionGuard: f.journal() }),
    /CONSUMED/
  )
})

for (const failure of ['file', 'directory']) {
  test(`${failure} fsync failure fails closed and never deletes reserved nonce`, async (t) => {
    const f = await fixture(t),
      journal = f.journal()
    const handle = await open(join(f.root, 'probe'), 'wx', 0o600)
    const prototype = Object.getPrototypeOf(handle)
    await handle.close()
    const originalSync = prototype.sync
    const sync = t.mock.method(prototype, 'sync', async function () {
      if ((await this.stat()).isDirectory() === (failure === 'directory'))
        throw new Error('fsync failed')
      return originalSync.call(this)
    })
    try {
      await assert.rejects(f.restore(journal), /fsync failed/)
    } finally {
      sync.mock.restore()
    }
    await assert.rejects(readFile(f.plaintext), { code: 'ENOENT' })
    assert.deepEqual(await readdir(f.usedDirectory), [])
    await assert.rejects(f.restore(f.journal()), /CONSUMED/)
  })
}

test('local receipt failure retains independently consumed nonce', async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.usedDirectory, f.payload.nonce))
  await assert.rejects(
    consumeRecoveryAuthorization({ ...f.args, consumptionGuard: f.journal() }),
    /CONSUMED/
  )
  await rm(join(f.usedDirectory, f.payload.nonce), { recursive: true })
  await assert.rejects(
    consumeRecoveryAuthorization({ ...f.args, consumptionGuard: f.journal() }),
    /CONSUMED/
  )
  assert.equal((await f.journal().readReceipts()).length, 1)
})

test('invalid signature and mismatched environment, run, config, checkpoint do not consume', async (t) => {
  const f = await fixture(t)
  for (const key of ['environmentId', 'recoveryId', 'configurationVersion', 'checkpointHash']) {
    await assert.rejects(
      consumeRecoveryAuthorization({
        ...f.args,
        expected: { ...f.args.expected, [key]: 'wrong' },
        consumptionGuard: f.journal()
      }),
      /MISMATCH/
    )
  }
  await f.save(generateKeyPairSync('ed25519').privateKey)
  await assert.rejects(
    consumeRecoveryAuthorization({ ...f.args, consumptionGuard: f.journal() }),
    /SIGNATURE/
  )
  assert.deepEqual(await readdir(f.directory), [])
  assert.deepEqual(await readdir(f.usedDirectory), [])
})

test('journal rejects wrong configuration and recovery run before reservation', async (t) => {
  const f = await fixture(t)
  for (const key of ['recoveryId', 'configurationVersion', 'checkpointHash']) {
    const journal = new publication.LocalRecoveryAuthorizationJournal({
      ...f.options,
      binding: {
        ...f.options.binding,
        [key]:
          key === 'recoveryId'
            ? randomUUID()
            : key === 'checkpointHash'
              ? 'c'.repeat(64)
              : 'config-other'
      }
    })
    await assert.rejects(
      consumeRecoveryAuthorization({ ...f.args, consumptionGuard: journal }),
      /MISMATCH/
    )
  }
  assert.deepEqual(await readdir(f.directory), [])
})

test('journal refuses overlap, symlink and permissive directory', async (t) => {
  const f = await fixture(t)
  for (const directory of [f.usedDirectory, join(f.usedDirectory, 'nested'), f.root]) {
    await assert.rejects(
      async () =>
        new publication.LocalRecoveryAuthorizationJournal({
          ...f.options,
          directory
        }).readReceipts(),
      /UNSAFE/
    )
  }
  const alias = join(f.root, 'alias')
  await symlink(f.directory, alias)
  await assert.rejects(
    new publication.LocalRecoveryAuthorizationJournal({
      ...f.options,
      directory: alias
    }).readReceipts(),
    /UNSAFE/
  )
  await chmod(f.directory, 0o755)
  await assert.rejects(f.journal().readReceipts(), /UNSAFE/)
})

test('snapshots reject malformed, linked and environment-mismatched journal entries', async (t) => {
  const f = await fixture(t)
  await consumeRecoveryAuthorization({ ...f.args, consumptionGuard: f.journal() })
  const entry = join(f.directory, f.payload.nonce)
  const original = await readFile(entry, 'utf8')
  await writeFile(entry, '{')
  await assert.rejects(f.journal().readReceipts())
  await writeFile(entry, original)
  const wrongEnvironment = new publication.LocalRecoveryAuthorizationJournal({
    ...f.options,
    binding: { ...f.options.binding, environmentId: 'other' }
  })
  await assert.rejects(wrongEnvironment.readReceipts(), /MISMATCH/)
  await link(entry, join(f.root, 'hardlink'))
  await assert.rejects(f.journal().readReceipts(), /UNSAFE/)
})

test('receipt fields must be strings, not values coerced by regular expressions', async (t) => {
  const f = await fixture(t)
  const receipt = {
    nonce: f.payload.nonce,
    recoveryId: f.payload.recoveryId,
    checkpointHash: f.payload.checkpointHash,
    configurationVersion: f.payload.configurationVersion,
    authorizationHash: 'a'.repeat(64),
    consumedAt: '2026-11-15T00:01:00.000Z'
  }
  await assert.rejects(
    f.journal().consume({ ...receipt, authorizationHash: [receipt.authorizationHash] }),
    /INVALID/
  )
  assert.deepEqual(await readdir(f.directory), [])
})
