import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, realpath, open, readdir, mkdtemp, rm, link } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import {
  encryptBackupPart,
  decryptBackupPart,
  syncBackupDirectory
} from '../delivery-files/backup-crypto.js'

export type CustodyRole = 'config' | 'payment' | 'delivery' | 'access' | 'ledger-records'
export interface CustodyBinding {
  environmentId: string
  configurationVersion: string | number
}
export type CustodyKeys = { manifest: Buffer } & Partial<Record<CustodyRole, Buffer>>
export interface CustodyFile {
  role: CustodyRole
  name: string
  source: string
  keyId: string
}
interface InventoryFile extends Omit<CustodyFile, 'source'> {
  bytes: number
  sha256: string
  encryptedHash: string
}
interface Manifest {
  version: 2
  bundleId: string
  binding: CustodyBinding
  files: InventoryFile[]
}
const roles = ['config', 'payment', 'delivery', 'access', 'ledger-records'] as const
const maxFiles = 16,
  maxBytes = 65536,
  maxLedgerBytes = 1048576,
  maxTotalBytes = 16777216,
  maxManifest = 16384
const fileLimit = (role: CustodyRole) => (role === 'ledger-records' ? maxLedgerBytes : maxBytes)
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const part = (file: Pick<CustodyFile, 'role' | 'name'>) => `${file.role}-${file.name}`
function requireValid(ok: unknown): asserts ok {
  if (!ok) throw new Error('Invalid custody material')
}
function fields(value: object, names: string[]) {
  requireValid(value && Object.keys(value).sort().join(',') === names.sort().join(','))
}
function checkedBinding(binding: CustodyBinding): CustodyBinding {
  fields(binding, ['environmentId', 'configurationVersion'])
  const { environmentId, configurationVersion } = binding
  const identifier = (v: unknown) =>
    typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(v)
  requireValid(identifier(environmentId))
  requireValid(
    identifier(configurationVersion) ||
      (typeof configurationVersion === 'number' &&
        Number.isSafeInteger(configurationVersion) &&
        configurationVersion >= 1)
  )
  return { environmentId, configurationVersion }
}
const bindingContext = (binding: CustodyBinding) =>
  JSON.stringify(['role-custody-v2', binding.environmentId, binding.configurationVersion])
const bundleContext = (binding: CustodyBinding, bundleId: string) =>
  JSON.stringify(['role-custody-v2', binding.environmentId, binding.configurationVersion, bundleId])
function inventory(files: InventoryFile[]) {
  requireValid(Array.isArray(files) && files.length > 0 && files.length <= maxFiles)
  const seen = new Set<string>()
  for (const file of files) {
    fields(file, ['role', 'name', 'keyId', 'bytes', 'sha256', 'encryptedHash'])
    requireValid(
      roles.includes(file.role) &&
        typeof file.name === 'string' &&
        /^[a-z][a-z0-9-]{0,47}$/.test(file.name)
    )
    requireValid(typeof file.keyId === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(file.keyId))
    requireValid(
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= fileLimit(file.role)
    )
    requireValid(/^[0-9a-f]{64}$/.test(file.sha256) && /^[0-9a-f]{64}$/.test(file.encryptedHash))
    requireValid(!seen.has(part(file)))
    seen.add(part(file))
  }
  requireValid(files.reduce((total, file) => total + file.bytes, 0) <= maxTotalBytes)
}
function wrappingKeys(keys: CustodyKeys, files: Pick<CustodyFile, 'role'>[]) {
  const used = ['manifest', ...new Set(files.map((f) => f.role))] as (keyof CustodyKeys)[]
  const distinct: Buffer[] = []
  for (const role of used) {
    const key = keys[role]
    requireValid(Buffer.isBuffer(key) && key.length === 32)
    requireValid(!distinct.some((other) => other.equals(key)))
    distinct.push(key)
  }
}
async function privateDirectory(directory: string, empty = false) {
  requireValid(resolve(directory) === directory && (await realpath(directory)) === directory)
  const s = await lstat(directory)
  requireValid(s.isDirectory() && s.uid === process.getuid?.() && (s.mode & 0o7777) === 0o700)
  if (empty) requireValid((await readdir(directory)).length === 0)
}
// Read through a checked descriptor with a fixed allocation; never follow a link or
// block on a substituted FIFO. Reject linked files and symlinks in parent paths too.
async function privateBytes(path: string, limit: number) {
  requireValid(resolve(path) === path && (await realpath(path)) === path)
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const data = Buffer.alloc(limit + 1)
  try {
    const s = await f.stat()
    requireValid(s.isFile() && s.uid === process.getuid?.() && !(s.mode & 0o077) && s.nlink === 1)
    requireValid(s.size <= limit)
    let size = 0
    while (size < data.length) {
      const { bytesRead } = await f.read(data, size, data.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    requireValid(size <= limit)
    return Buffer.from(data.subarray(0, size))
  } finally {
    data.fill(0)
    await f.close()
  }
}

/** Owner/offline use only; caller supplies independent 32-byte manifest and role
 * keys out of band. At most 16 opaque files, 16 MiB total; ledger-records is
 * capped at 1 MiB per file, other roles at 64 KiB. Names are lower-case
 * slugs (48 chars), output is <role>-<name>. keyId is an inventory identifier,
 * not a key. Config may include multiple files; references inside it are opaque
 * and are NOT rewritten. No arbitrator/multisig-member role is accepted.
 * Binding is authenticated in both manifest and every part AAD alongside a
 * generated bundleId; versions accept bounded identifiers or positive integers.
 * The opaque ledger-records role copies bytes only; it never constructs records.
 *
 * Both roots must already be owned real 0700 directories. Caller must exclude
 * concurrent writers to roots/ancestors for the operation (no hostile same-UID
 * process protection). This is local custody simulation, not hardware custody,
 * freshness proof, application activation, or signer authorization validation.
 */
export async function backupRoleCustody(options: {
  directory: string
  files: CustodyFile[]
  keys: CustodyKeys
  binding: CustodyBinding
}): Promise<void> {
  let stage: string | undefined
  const published: string[] = [],
    plaintext: Buffer[] = []
  try {
    const { directory, files, keys } = options
    const binding = checkedBinding(options.binding)
    await privateDirectory(directory, true)
    requireValid(Array.isArray(files) && files.length > 0 && files.length <= maxFiles)
    const entries = files.map((file) => {
      fields(file, ['role', 'name', 'source', 'keyId'])
      return {
        role: file.role,
        name: file.name,
        keyId: file.keyId,
        bytes: 0,
        sha256: '0'.repeat(64),
        encryptedHash: '0'.repeat(64)
      }
    })
    inventory(entries)
    wrappingKeys(keys, entries)
    for (const file of files) plaintext.push(await privateBytes(file.source, fileLimit(file.role)))
    stage = await mkdtemp(join(directory, '.custody-'))
    const manifest: Manifest = { version: 2, bundleId: randomUUID(), binding, files: entries }
    for (const [i, entry] of entries.entries()) {
      entry.bytes = plaintext[i].length
      entry.sha256 = hash(plaintext[i])
      entry.encryptedHash = await encryptBackupPart(
        stage,
        bundleContext(binding, manifest.bundleId),
        part(entry),
        keys[entry.role]!,
        Readable.from([plaintext[i]])
      )
    }
    inventory(entries)
    const data = Buffer.from(JSON.stringify(manifest))
    try {
      requireValid(data.length <= maxManifest)
      await encryptBackupPart(
        stage,
        bindingContext(binding),
        'manifest',
        keys.manifest,
        Readable.from([data])
      )
    } finally {
      data.fill(0)
    }
    // Hard links publish exclusively: unlike rename they can never overwrite.
    for (const name of [...entries.map((file) => part(file) + '.enc'), 'manifest.enc']) {
      const path = join(directory, name)
      await link(join(stage, name), path)
      published.push(path)
    }
    await rm(stage, { recursive: true })
    stage = undefined
    await syncBackupDirectory(directory)
  } catch {
    for (const path of published) await rm(path)
    throw new Error('Role custody backup rejected')
  } finally {
    for (const data of plaintext) data.fill(0)
    if (stage) await rm(stage, { recursive: true, force: true })
  }
}

/** Restore authenticates every part before exclusively publishing any plaintext.
 * Returns inventory plus absolute paths only, never contents. Destination must
 * exist and be empty/owned/real/0700; failure removes our staged/published files.
 * Supplied role keys declare the exact required role set (multiple files per role
 * allowed). expectedBinding must come from the parent authorization, not this
 * bundle. Parent verifies pinned signatures and consumes one-use authorization
 * BEFORE calling restore; then reopens loaders and checks role authorization in
 * a fresh process. Matching same-environment/version replay is a parent concern.
 */
export async function restoreRoleCustody(options: {
  directory: string
  destination: string
  keys: CustodyKeys
  expectedBinding: CustodyBinding
}): Promise<(InventoryFile & { path: string })[]> {
  let stage: string | undefined
  const published: string[] = []
  try {
    const { directory, destination, keys } = options
    const binding = checkedBinding(options.expectedBinding)
    await privateDirectory(directory)
    await privateDirectory(destination, true)
    wrappingKeys(keys, [])
    const encrypted = await privateBytes(join(directory, 'manifest.enc'), maxManifest + 28)
    requireValid(encrypted.length >= 28)
    stage = await mkdtemp(join(destination, '.custody-'))
    const manifestPath = join(stage, 'manifest')
    await decryptBackupPart(
      directory,
      bindingContext(binding),
      'manifest',
      keys.manifest,
      manifestPath
    )
    const data = await privateBytes(manifestPath, maxManifest)
    let manifest: Manifest
    try {
      manifest = JSON.parse(data.toString('utf8')) as Manifest
    } finally {
      data.fill(0)
    }
    fields(manifest, ['version', 'bundleId', 'binding', 'files'])
    requireValid(bindingContext(checkedBinding(manifest.binding)) === bindingContext(binding))
    requireValid(
      manifest.version === 2 &&
        typeof manifest.bundleId === 'string' &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(manifest.bundleId)
    )
    inventory(manifest.files)
    wrappingKeys(keys, manifest.files)
    const suppliedRoles = Object.keys(keys)
      .filter((role) => role !== 'manifest')
      .sort()
    const storedRoles = [...new Set(manifest.files.map((file) => file.role))].sort()
    requireValid(JSON.stringify(suppliedRoles) === JSON.stringify(storedRoles))
    const expected = ['manifest.enc', ...manifest.files.map((file) => part(file) + '.enc')].sort()
    requireValid(JSON.stringify((await readdir(directory)).sort()) === JSON.stringify(expected))
    for (const file of manifest.files) {
      const ciphertext = await privateBytes(
        join(directory, part(file) + '.enc'),
        fileLimit(file.role) + 28
      )
      requireValid(ciphertext.length === file.bytes + 28 && hash(ciphertext) === file.encryptedHash)
      const path = join(stage, part(file))
      await decryptBackupPart(
        directory,
        bundleContext(binding, manifest.bundleId),
        part(file),
        keys[file.role]!,
        path
      )
      const plain = await privateBytes(path, fileLimit(file.role))
      try {
        requireValid(plain.length === file.bytes && hash(plain) === file.sha256)
      } finally {
        plain.fill(0)
      }
    }
    for (const file of manifest.files) {
      const path = join(destination, part(file))
      await link(join(stage, part(file)), path)
      published.push(path)
    }
    await rm(stage, { recursive: true })
    stage = undefined
    await syncBackupDirectory(destination)
    return manifest.files.map((file) => ({ ...file, path: join(destination, part(file)) }))
  } catch {
    for (const path of published) await rm(path)
    throw new Error('Role custody restore rejected')
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true })
  }
}
