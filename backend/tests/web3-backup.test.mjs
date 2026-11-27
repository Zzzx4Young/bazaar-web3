import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const m = await import('../dist/delivery-files/backup-crypto.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
test('T10 encrypted backups authenticate bytes, identity and key without plaintext backup parts', async () => {
  assert.equal(typeof m.encryptBackupPart, 'function')
  const root = await mkdtemp(join(tmpdir(), 'bazaar-backup-crypto-')),
    key = randomBytes(32),
    id = randomUUID(),
    bytes = Buffer.from('private evidence never in ciphertext')
  try {
    await m.encryptBackupPart(root, id, 'sample', key, Readable.from([bytes]))
    const encrypted = await readFile(join(root, 'sample.enc'))
    assert.equal(encrypted.includes(bytes), false)
    const output = join(root, 'output')
    await m.decryptBackupPart(root, id, 'sample', key, output)
    assert.deepEqual(await readFile(output), bytes)
    await rm(output)
    await assert.rejects(m.decryptBackupPart(root, randomUUID(), 'sample', key, output))
    await rm(output, { force: true })
    await assert.rejects(m.decryptBackupPart(root, id, 'sample', randomBytes(32), output))
    await rm(output, { force: true })
    encrypted[16] ^= 1
    await writeFile(join(root, 'sample.enc'), encrypted)
    await assert.rejects(m.decryptBackupPart(root, id, 'sample', key, output))
    await assert.rejects(m.encryptBackupPart(root, id, '../escape', key, Readable.from([bytes])))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
