import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  chmod,
  symlink,
  link,
  stat
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import ts from 'typescript'

// Compile only these two source modules into a test-owned temp tree: concurrent builds
// can replace dist without changing what this suite exercises. Never load .env or a DB.
let compiled,
  custody = {},
  crypto
before(async () => {
  compiled = await mkdtemp(join(tmpdir(), 'custody-code-'))
  await writeFile(join(compiled, 'package.json'), '{"type":"module"}')
  for (const file of ['delivery-files/backup-crypto', 'auth/recovery-custody']) {
    let source
    try {
      source = await readFile(new URL(`../src/${file}.ts`, import.meta.url), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    await mkdir(join(compiled, file.split('/')[0]), { recursive: true })
    await writeFile(
      join(compiled, `${file}.js`),
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
      }).outputText
    )
  }
  crypto = await import(pathToFileURL(join(compiled, 'delivery-files/backup-crypto.js')))
  try {
    custody = await import(pathToFileURL(join(compiled, 'auth/recovery-custody.js')))
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  }
})
after(async () => {
  await rm(compiled, { recursive: true, force: true })
})

async function fixture(t) {
  assert.equal(typeof custody.backupRoleCustody, 'function', 'role custody backup is implemented')
  assert.equal(typeof custody.restoreRoleCustody, 'function', 'role custody restore is implemented')
  const root = await mkdtemp(join(tmpdir(), 'custody-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const dir of ['source', 'backup', 'restore']) await mkdir(join(root, dir), { mode: 0o700 })
  const keys = Object.fromEntries(
    ['manifest', 'config', 'payment', 'delivery', 'access'].map((role) => [role, randomBytes(32)])
  )
  const contents = {
    config: Buffer.from('{"ledgerId":"synthetic-local-config"}'),
    payment: Buffer.from(
      JSON.stringify({ key: `0x${'11'.repeat(32)}`, keyId: `0x${'a1'.repeat(32)}` })
    ),
    delivery: Buffer.from(
      JSON.stringify({ key: `0x${'22'.repeat(32)}`, keyId: `0x${'b2'.repeat(32)}` })
    ),
    access: randomBytes(32)
  }
  const files = []
  for (const [role, data] of Object.entries(contents)) {
    const source = join(root, 'source', role)
    await writeFile(source, data, { mode: 0o600 })
    files.push({ role, name: 'primary', source, keyId: `${role}-local-v1` })
  }
  const binding = { environmentId: 'isolated-recovery-test', configurationVersion: 2 }
  const manifestContext = JSON.stringify([
    'role-custody-v2',
    binding.environmentId,
    binding.configurationVersion
  ])
  const backup = join(root, 'backup'),
    destination = join(root, 'restore')
  return {
    root,
    keys,
    files,
    contents,
    binding,
    manifestContext,
    backup,
    destination,
    save: (options = {}) =>
      custody.backupRoleCustody({ directory: backup, files, keys, binding, ...options }),
    restore: (options = {}) =>
      custody.restoreRoleCustody({
        directory: backup,
        destination,
        keys,
        expectedBinding: binding,
        ...options
      })
  }
}

test('restores exact role bytes and encrypted inventory using private files', async (t) => {
  const f = await fixture(t)
  await f.save()
  assert.deepEqual((await readdir(f.backup)).sort(), [
    'access-primary.enc',
    'config-primary.enc',
    'delivery-primary.enc',
    'manifest.enc',
    'payment-primary.enc'
  ])
  for (const file of await readdir(f.backup)) {
    const bytes = await readFile(join(f.backup, file))
    for (const value of Object.values(f.contents)) assert.equal(bytes.includes(value), false)
  }
  const inventory = await f.restore()
  assert.equal(inventory.length, 4)
  for (const entry of inventory) {
    assert.equal(entry.keyId, `${entry.role}-local-v1`)
    assert.equal(entry.bytes, f.contents[entry.role].length)
    assert.match(entry.sha256, /^[0-9a-f]{64}$/)
    assert.deepEqual(await readFile(entry.path), f.contents[entry.role])
    assert.equal((await stat(entry.path)).mode & 0o777, 0o600)
  }
})

for (const fault of [
  'wrong-role-key',
  'missing-role-key',
  'wrong-manifest-key',
  'short-key',
  'swapped-keys',
  'ciphertext',
  'manifest',
  'missing-file',
  'extra-file',
  'symlink-part',
  'oversized-part'
]) {
  test(`restore rejects ${fault} and leaves no plaintext`, async (t) => {
    const f = await fixture(t)
    await f.save()
    const keys = { ...f.keys }
    if (fault === 'wrong-role-key') keys.delivery = randomBytes(32)
    if (fault === 'missing-role-key') delete keys.access
    if (fault === 'wrong-manifest-key') keys.manifest = randomBytes(32)
    if (fault === 'short-key') keys.config = Buffer.alloc(31)
    if (fault === 'swapped-keys') [keys.payment, keys.delivery] = [keys.delivery, keys.payment]
    if (['ciphertext', 'manifest'].includes(fault)) {
      const path = join(f.backup, fault === 'manifest' ? 'manifest.enc' : 'delivery-primary.enc')
      const data = await readFile(path)
      data[15] ^= 1
      await writeFile(path, data)
    }
    if (fault === 'missing-file') await rm(join(f.backup, 'access-primary.enc'))
    if (fault === 'extra-file') await writeFile(join(f.backup, 'unexpected'), 'x', { mode: 0o600 })
    if (fault === 'symlink-part') {
      await rm(join(f.backup, 'access-primary.enc'))
      await symlink(f.files[0].source, join(f.backup, 'access-primary.enc'))
    }
    if (fault === 'oversized-part')
      await writeFile(join(f.backup, 'access-primary.enc'), Buffer.alloc(65565))
    await assert.rejects(f.restore({ keys }), /Role custody restore rejected/)
    assert.deepEqual(await readdir(f.destination), [])
  })
}

for (const fault of [
  'traversal',
  'duplicate',
  'arbitrator',
  'multisig-member',
  'public-source',
  'symlink-source',
  'hardlink-source',
  'oversized-source',
  'too-many-files',
  'reused-key',
  'public-backup'
]) {
  test(`backup rejects ${fault} without publishing a partial backup`, async (t) => {
    const f = await fixture(t)
    if (fault === 'traversal') f.files[0].name = '../escape'
    if (fault === 'duplicate') f.files.push({ ...f.files[0] })
    if (['arbitrator', 'multisig-member'].includes(fault)) f.files[0].role = fault
    if (fault === 'public-source') await chmod(f.files[0].source, 0o644)
    if (fault === 'symlink-source') {
      const target = f.files[0].source
      f.files[0].source += '-link'
      await symlink(target, f.files[0].source)
    }
    if (fault === 'hardlink-source') await link(f.files[0].source, join(f.root, 'alias'))
    if (fault === 'oversized-source') await writeFile(f.files[0].source, Buffer.alloc(65537))
    if (fault === 'too-many-files')
      f.files.push(...Array.from({ length: 13 }, (_, i) => ({ ...f.files[0], name: `copy-${i}` })))
    if (fault === 'reused-key') f.keys.delivery = f.keys.payment
    if (fault === 'public-backup') await chmod(f.backup, 0o755)
    await assert.rejects(f.save(), /Role custody backup rejected/)
    assert.deepEqual(await readdir(f.backup), [])
  })
}

for (const fault of ['nonempty', 'symlink', 'public', 'missing', 'parent-symlink']) {
  test(`restore requires an empty owned real 0700 root: ${fault}`, async (t) => {
    const f = await fixture(t)
    await f.save()
    let destination = f.destination
    if (fault === 'nonempty')
      await writeFile(join(destination, 'keep'), 'untouched', { mode: 0o600 })
    if (fault === 'symlink') {
      await rm(destination, { recursive: true })
      await symlink(join(f.root, 'source'), destination)
    }
    if (fault === 'public') await chmod(destination, 0o755)
    if (fault === 'missing') await rm(destination, { recursive: true })
    if (fault === 'parent-symlink') {
      await symlink(f.root, join(f.root, 'alias'))
      destination = join(f.root, 'alias', 'restore')
    }
    await assert.rejects(f.restore({ destination }), /Role custody restore rejected/)
    if (fault === 'nonempty')
      assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'untouched')
    assert.deepEqual(await readFile(f.files[0].source), f.contents.config)
  })
}

test('authenticated manifest rejects invalid inventory and mismatched plaintext hash/bytes', async (t) => {
  const f = await fixture(t)
  await f.save()
  const plain = join(f.root, 'manifest')
  await crypto.decryptBackupPart(f.backup, f.manifestContext, 'manifest', f.keys.manifest, plain)
  const original = JSON.parse(await readFile(plain, 'utf8'))
  for (const change of [
    (m) => {
      m.files[0].bytes++
    },
    (m) => {
      m.files[0].sha256 = '0'.repeat(64)
    },
    (m) => {
      m.files[0].role = 'arbitrator'
    },
    (m) => {
      m.files[0].name = '../escape'
    },
    (m) => {
      m.files.push(m.files[0])
    },
    (m) => {
      m.extra = true
    },
    (m) => {
      m.files[0].keyId = ''
    },
    (m) => {
      m.files[0].name = ['primary']
    }
  ]) {
    const manifest = JSON.parse(JSON.stringify(original))
    change(manifest)
    await rm(join(f.backup, 'manifest.enc'))
    await crypto.encryptBackupPart(
      f.backup,
      f.manifestContext,
      'manifest',
      f.keys.manifest,
      Readable.from([JSON.stringify(manifest)])
    )
    await assert.rejects(f.restore(), /Role custody restore rejected/)
    assert.deepEqual(await readdir(f.destination), [])
  }
})

test('parts from another valid backup cannot be substituted', async (t) => {
  const a = await fixture(t),
    b = await fixture(t)
  await a.save()
  await b.save({ keys: a.keys })
  await writeFile(
    join(a.backup, 'access-primary.enc'),
    await readFile(join(b.backup, 'access-primary.enc'))
  )
  await assert.rejects(a.restore(), /Role custody restore rejected/)
  assert.deepEqual(await readdir(a.destination), [])
})

test('GCM authentication failure removes partially decrypted candidate files', async (t) => {
  const f = await fixture(t)
  await f.save()
  const plain = join(f.root, 'manifest')
  await crypto.decryptBackupPart(f.backup, f.manifestContext, 'manifest', f.keys.manifest, plain)
  const manifest = JSON.parse(await readFile(plain, 'utf8'))
  const path = join(f.backup, 'access-primary.enc')
  const data = await readFile(path)
  data[data.length - 1] ^= 1
  await writeFile(path, data)
  manifest.files.find((file) => file.role === 'access').encryptedHash = createHash('sha256')
    .update(data)
    .digest('hex')
  await rm(join(f.backup, 'manifest.enc'))
  await crypto.encryptBackupPart(
    f.backup,
    f.manifestContext,
    'manifest',
    f.keys.manifest,
    Readable.from([JSON.stringify(manifest)])
  )
  await assert.rejects(f.restore(), /Role custody restore rejected/)
  assert.deepEqual(await readdir(f.destination), [])
})

test('supports multiple config files, zero-length files and the per-file byte boundary', async (t) => {
  const f = await fixture(t)
  const source = join(f.root, 'source', 'url-reference')
  await writeFile(source, Buffer.alloc(0), { mode: 0o600 })
  f.files.push({ role: 'config', name: 'url-reference', source, keyId: 'config-local-v1' })
  await writeFile(f.files[3].source, Buffer.alloc(65536, 42))
  await f.save()
  const inventory = await f.restore()
  assert.equal(inventory.length, 5)
  assert.equal((await readFile(join(f.destination, 'config-url-reference'))).length, 0)
  assert.deepEqual(await readFile(join(f.destination, 'access-primary')), Buffer.alloc(65536, 42))
})

for (const field of ['environmentId', 'configurationVersion']) {
  test(`expected binding rejects a different ${field} even with compatible keys`, async (t) => {
    const f = await fixture(t)
    await f.save()
    const expectedBinding = {
      ...f.binding,
      [field]: field === 'environmentId' ? 'another-environment' : 3
    }
    await assert.rejects(f.restore({ expectedBinding }), /Role custody restore rejected/)
    assert.deepEqual(await readdir(f.destination), [])
  })
}

for (const binding of [
  undefined,
  {},
  { environmentId: '', configurationVersion: 2 },
  { environmentId: 'test', configurationVersion: -1 },
  { environmentId: 'test', configurationVersion: 1.5 },
  { environmentId: 'test', configurationVersion: 2, extra: true }
]) {
  test(`missing or invalid binding rejects backup and restore: ${JSON.stringify(binding)}`, async (t) => {
    const f = await fixture(t)
    await assert.rejects(f.save({ binding }), /Role custody backup rejected/)
    assert.deepEqual(await readdir(f.backup), [])
    await f.save()
    await assert.rejects(f.restore({ expectedBinding: binding }), /Role custody restore rejected/)
    assert.deepEqual(await readdir(f.destination), [])
  })
}

test('binding and generated bundle identity are authenticated in manifest and role AAD', async (t) => {
  const f = await fixture(t)
  await f.save()
  const plain = join(f.root, 'manifest')
  await crypto.decryptBackupPart(f.backup, f.manifestContext, 'manifest', f.keys.manifest, plain)
  const original = JSON.parse(await readFile(plain, 'utf8'))
  assert.deepEqual(original.binding, f.binding)
  assert.match(original.bundleId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)
  for (const change of [
    (m) => {
      m.binding.environmentId = 'another-environment'
    },
    (m) => {
      m.binding.configurationVersion = 3
    },
    (m) => {
      delete m.binding
    },
    (m) => {
      m.bundleId = '00000000-0000-4000-8000-000000000001'
    }
  ]) {
    const manifest = JSON.parse(JSON.stringify(original))
    change(manifest)
    await rm(join(f.backup, 'manifest.enc'))
    await crypto.encryptBackupPart(
      f.backup,
      f.manifestContext,
      'manifest',
      f.keys.manifest,
      Readable.from([JSON.stringify(manifest)])
    )
    await assert.rejects(f.restore(), /Role custody restore rejected/)
    assert.deepEqual(await readdir(f.destination), [])
  }
})

test('whole bundle from wrong environment or configuration cannot be substituted', async (t) => {
  for (const binding of [
    { environmentId: 'another-environment', configurationVersion: 2 },
    { environmentId: 'isolated-recovery-test', configurationVersion: 3 }
  ]) {
    const f = await fixture(t)
    await f.save({ binding })
    await assert.rejects(f.restore(), /Role custody restore rejected/)
    assert.deepEqual(await readdir(f.destination), [])
  }
})

test('ledger-records preserves an opaque native dump up to one MiB', async (t) => {
  const f = await fixture(t)
  const source = join(f.root, 'source', 'native-dump')
  const dump = Buffer.alloc(1048576, 42)
  Buffer.from('PGDMP').copy(dump)
  await writeFile(source, dump, { mode: 0o600 })
  f.keys['ledger-records'] = randomBytes(32)
  f.files.push({ role: 'ledger-records', name: 'native-dump', source, keyId: 'ledger-snapshot-v2' })
  await f.save()
  const entries = await f.restore()
  const entry = entries.find((file) => file.role === 'ledger-records')
  assert.equal(entry.bytes, 1048576)
  assert.deepEqual(await readFile(entry.path), dump)
  assert.equal((await stat(entry.path)).mode & 0o777, 0o600)
})

test('ledger-records larger than one MiB rejects without leaving partial material', async (t) => {
  const f = await fixture(t)
  const source = join(f.root, 'source', 'native-dump')
  await writeFile(source, Buffer.alloc(1048577), { mode: 0o600 })
  f.keys['ledger-records'] = randomBytes(32)
  f.files.push({ role: 'ledger-records', name: 'native-dump', source, keyId: 'ledger-snapshot-v2' })
  await assert.rejects(f.save(), /Role custody backup rejected/)
  assert.deepEqual(await readdir(f.backup), [])
})

test('authenticated omission of a role declared by supplied keys is rejected', async (t) => {
  const f = await fixture(t)
  await f.save()
  const plain = join(f.root, 'manifest')
  await crypto.decryptBackupPart(f.backup, f.manifestContext, 'manifest', f.keys.manifest, plain)
  const manifest = JSON.parse(await readFile(plain, 'utf8'))
  manifest.files = manifest.files.filter((file) => file.role !== 'access')
  await rm(join(f.backup, 'access-primary.enc'))
  await rm(join(f.backup, 'manifest.enc'))
  await crypto.encryptBackupPart(
    f.backup,
    f.manifestContext,
    'manifest',
    f.keys.manifest,
    Readable.from([JSON.stringify(manifest)])
  )
  await assert.rejects(f.restore(), /Role custody restore rejected/)
  assert.deepEqual(await readdir(f.destination), [])
})
