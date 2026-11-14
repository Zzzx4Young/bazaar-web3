import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retentionFixture } from './helpers/retention.mjs'
import { PrivateBackupService } from '../dist/delivery-files/private-backup.js'
import { decryptBackupPart } from '../dist/delivery-files/backup-crypto.js'

test('T10/A27/A28: native exported database snapshot and immutable objects form one encrypted authenticated backup', async () => {
  const t = await retentionFixture(),
    root = await mkdtemp(join(tmpdir(), 'bazaar-backup-')),
    key = randomBytes(32)
  try {
    const v = await t.version(),
      s = new PrivateBackupService(t.db.client, t.db.url, t.store, t.p.ledger, key, root)
    const b = await s.create()
    assert.equal(b.objects.length, 1)
    assert.equal((await s.read(b.id)).objects[0].sha256, v.sha256)
    const dir = join(root, b.id)
    assert.deepEqual((await readdir(dir)).sort(), ['database.enc', 'manifest.enc', 'object-0.enc'])
    const raw = await readFile(join(dir, 'manifest.enc'))
    assert.equal(raw.includes(Buffer.from(v.objectKey)), false)
    const dump = join(root, 'dump'),
      object = join(root, 'object')
    await decryptBackupPart(dir, b.id, 'database', key, dump)
    assert.equal((await readFile(dump)).subarray(0, 5).toString(), 'PGDMP')
    await decryptBackupPart(dir, b.id, 'object-0', key, object)
    const { createHash } = await import('node:crypto')
    assert.equal(
      createHash('sha256')
        .update(await readFile(object))
        .digest('hex'),
      v.sha256
    )
    raw[15] ^= 1
    await writeFile(join(dir, 'manifest.enc'), raw)
    await assert.rejects(s.read(b.id), /changed/)
  } finally {
    await t.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('T10: incomplete or missing objects never publish an available backup; original14day expiry is not renewed', async () => {
  const t = await retentionFixture(),
    root = await mkdtemp(join(tmpdir(), 'bazaar-backup-expiry-')),
    key = randomBytes(32)
  try {
    const v = await t.version(),
      s = new PrivateBackupService(t.db.client, t.db.url, t.store, t.p.ledger, key, root, t.now)
    const b = await s.create()
    t.clock(b.expiresAt)
    await assert.rejects(s.read(b.id), /expired/)
    assert.equal((await s.expire()).removed, 1)
    assert.equal((await s.expire()).removed, 0)
    assert.equal((await t.p.ledger.find('backup_deleted', b.id)).payload.expiresAt, b.expiresAt)
    t.clock('2026-01-01')
    await t.store.deleteAndConfirm(v.objectKey)
    await assert.rejects(s.create())
    assert.equal((await t.p.ledger.records('backup')).length, 1)
  } finally {
    await t.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('T10: native restore creates the archived schema in a fresh database and imports objects behind the recovery gate', async () => {
  const t = await retentionFixture(),
    root = await mkdtemp(join(tmpdir(), 'bazaar-native-restore-')),
    key = randomBytes(32)
  const { DatabaseService } = await import('../dist/database/database.service.js'),
    { PrivateRecoveryService } = await import('../dist/delivery-files/private-recovery.js'),
    { LocalPrivateObjectStore } = await import('../dist/delivery-files/object-store.js')
  const { randomUUID } = await import('node:crypto')
  let target, name
  try {
    const v = await t.version(),
      b = new PrivateBackupService(t.db.client, t.db.url, t.store, t.p.ledger, key, root),
      m = await b.create()
    name = 'bazaar_web3_restore_' + randomUUID().replaceAll('-', '')
    await t.db.client.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    const url = new URL(t.db.url)
    url.pathname = '/' + name
    target = new DatabaseService(url.toString())
    await target.onModuleInit()
    const objectRoot = join(root, 'restored-objects')
    await (await import('node:fs/promises')).mkdir(objectRoot, { mode: 0o700 })
    const store = new LocalPrivateObjectStore(objectRoot)
    const wallet = {
      client: t.security.client,
      ledgerId: t.security.id,
      verify: async () => {},
      run: (work) => t.security.client.$transaction(work)
    }
    const r = new PrivateRecoveryService(b, wallet, t.config, {})
    const out = await r.restoreIsolated(m.id, target.client, url, store)
    assert.deepEqual(out.missing, [])
    assert.equal(
      (await target.client.privateRecoveryState.findUniqueOrThrow({ where: { singleton: true } }))
        .status,
      'isolated'
    )
    assert.equal(
      (await target.client.privateFileVersion.findUniqueOrThrow({ where: { id: v.id } }))
        .objectVersion,
      v.objectVersion
    )
    const chunks = []
    for await (const c of await store.read(v.objectKey)) chunks.push(c)
    const { createHash } = await import('node:crypto')
    assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), v.sha256)
    assert.equal(await target.client.session.count({ where: { revokedAt: null } }), 0)
  } finally {
    if (target) await target.onModuleDestroy()
    if (name) await t.db.client.$executeRawUnsafe(`DROP DATABASE "${name}"`)
    await t.close()
    await rm(root, { recursive: true, force: true })
  }
})
