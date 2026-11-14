import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, readFile, lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { PrivateObjectStore } from './object-store.js'
import { PrivateLifecycleLedger } from './deletion-ledger.js'
import {
  encryptBackupPart,
  decryptBackupPart,
  encryptedPartHash,
  syncBackupDirectory
} from './backup-crypto.js'
const life = 14 * 86400000
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
export interface BackupObject {
  id: string
  orderId: string
  ownerId: string
  uploadId: string
  objectKey: string
  objectVersion: string
  sha256: string
  byteSize: number
  filename: string
  contentType: string
  purpose: string
  part: string
  encryptedHash: string
}
export interface BackupManifest {
  version: 1
  id: string
  schema: string
  createdAt: string
  consistentPointAt: string
  expiresAt: string
  databaseHash: string
  objects: BackupObject[]
}
export async function privateRoot(path: string) {
  if (resolve(path) !== path) throw new Error('Absolute private root required')
  const s = await lstat(path)
  if (
    !s.isDirectory() ||
    s.uid !== process.getuid?.() ||
    s.mode & 0o077 ||
    (await realpath(path)) !== path
  )
    throw new Error('Unsafe private backup root')
}
export function pgChild(program: 'pg_dump' | 'pg_restore', args: string[], url: URL) {
  const c = spawn(program, args, {
    env: {
      PATH: process.env.PATH,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  c.stderr.on('data', (b) => {
    if (stderr.length < 4000) stderr += b.toString()
  })
  const done = new Promise<void>((ok, no) => {
    c.once('error', no)
    c.once('exit', (code) =>
      code === 0
        ? ok()
        : no(
            new Error(
              program +
                ' failed: ' +
                stderr.replaceAll(decodeURIComponent(url.password), '[REDACTED]')
            )
          )
    )
  })
  // Always install a rejection handler before streaming stdout.
  done.catch(() => undefined)
  return { process: c, stdout: c.stdout, done }
}
export class PrivateBackupService {
  constructor(
    readonly client: PrismaClient,
    readonly url: URL,
    readonly store: PrivateObjectStore,
    readonly ledger: PrivateLifecycleLedger,
    readonly key: Buffer,
    readonly root: string,
    readonly now: () => Date = () => new Date()
  ) {
    if (key.length !== 32) throw new Error('Separate32byte backup key required')
  }
  async create() {
    await privateRoot(this.root)
    await this.ledger.verify()
    const id = randomUUID(),
      directory = join(this.root, id),
      createdAt = this.now(),
      expiresAt = new Date(createdAt.getTime() + life)
    await this.ledger.append('backup_prepared', id, {
      id,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    })
    await mkdir(directory, { mode: 0o700 })
    let ledgerAttempted = false
    try {
      const manifest = await this.client.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('private-files:' || current_schema(),0))`
          const [meta] = await tx.$queryRaw<
            { schema: string; snapshot: string; point: Date }[]
          >`SELECT current_schema() AS schema,pg_export_snapshot() AS snapshot,transaction_timestamp() AS point`
          if (
            !/^[a-z][a-z0-9_]{0,62}$/.test(meta.schema) ||
            this.url.searchParams.get('schema') !== meta.schema
          )
            throw new Error('Backup schema mismatch')
          const pending = await tx.privateFileDisposition.count({ where: { state: 'claimed' } })
          const gate = await tx.privateRecoveryState.findUnique({ where: { singleton: true } })
          if (pending || (gate && gate.status !== 'active'))
            throw new Error('Incomplete private lifecycle blocks backup')
          const dump = pgChild(
            'pg_dump',
            [
              '--format=custom',
              '--no-owner',
              '--no-privileges',
              '--snapshot=' + meta.snapshot,
              '--schema=' + meta.schema
            ],
            this.url
          )
          let databaseHash: string
          try {
            databaseHash = await encryptBackupPart(directory, id, 'database', this.key, dump.stdout)
            await dump.done
          } catch (e) {
            dump.process.kill('SIGTERM')
            await dump.done.catch(() => undefined)
            throw e
          }
          const versions = await tx.privateFileVersion.findMany({ orderBy: { id: 'asc' } }),
            objects: BackupObject[] = []
          for (const v of versions) {
            const upload = await tx.privateUpload.findUnique({ where: { id: v.uploadId } })
            const fence = await tx.privateFileDisposition.findUnique({ where: { versionId: v.id } })
            if (fence?.state === 'deleted' || upload?.status === 'cleaned') continue
            if (upload?.status !== 'ready') throw new Error('Immutable version is not ready')
            const independent = await this.ledger.find('claim', v.id)
            if (independent) throw new Error('Independent deletion fence blocks backup')
            const hash = createHash('sha256')
            let bytes = 0
            const meter = new Transform({
              transform(chunk: Buffer, _e, cb) {
                bytes += chunk.length
                if (bytes > v.byteSize) return cb(new Error('Object exceeds snapshot'))
                hash.update(chunk)
                cb(null, chunk)
              }
            })
            const source = await this.store.read(v.objectKey, AbortSignal.timeout(120000))
            source.once('error', (e) => meter.destroy(e))
            meter.once('error', () => source.destroy())
            source.pipe(meter)
            const part = 'object-' + objects.length,
              encryptedHash = await encryptBackupPart(directory, id, part, this.key, meter)
            if (bytes !== v.byteSize || hash.digest('hex') !== v.sha256)
              throw new Error('Private object differs from database snapshot')
            objects.push({ ...v, part, encryptedHash })
          }
          return {
            version: 1 as const,
            id,
            schema: meta.schema,
            createdAt: createdAt.toISOString(),
            consistentPointAt: meta.point.toISOString(),
            expiresAt: expiresAt.toISOString(),
            databaseHash,
            objects
          }
        },
        { isolationLevel: 'RepeatableRead', timeout: 900000 }
      )
      const manifestHash = await encryptBackupPart(
        directory,
        id,
        'manifest',
        this.key,
        Readable.from([JSON.stringify(manifest)])
      )
      await syncBackupDirectory(directory)
      await syncBackupDirectory(this.root)
      if (this.now().getTime() >= expiresAt.getTime())
        throw new Error('Backup expired before completion')
      ledgerAttempted = true
      await this.ledger.append('backup', id, {
        id,
        createdAt: manifest.createdAt,
        consistentPointAt: manifest.consistentPointAt,
        expiresAt: manifest.expiresAt,
        manifestHash,
        objectCount: manifest.objects.length
      })
      return manifest
    } catch (e) {
      if (!ledgerAttempted) await rm(directory, { recursive: true, force: true })
      throw e
    }
  }
  async read(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid backup ID')
    await privateRoot(this.root)
    const record = await this.ledger.find('backup', id),
      removed = await this.ledger.find('backup_deleted', id)
    if (!record || removed || this.now().getTime() >= Date.parse(String(record.payload.expiresAt)))
      throw new Error('Backup unavailable or expired')
    const directory = join(this.root, id)
    await privateRoot(directory)
    if ((await encryptedPartHash(directory, 'manifest')) !== record.payload.manifestHash)
      throw new Error('Backup manifest changed')
    const scratch = await mkdtemp(join(this.root, '.verify-'))
    try {
      const output = join(scratch, 'manifest')
      await decryptBackupPart(directory, id, 'manifest', this.key, output)
      const s = await lstat(output)
      if (s.size > 8_000_000) throw new Error('Backup manifest too large')
      const m = JSON.parse(await readFile(output, 'utf8')) as BackupManifest
      if (
        m.version !== 1 ||
        m.id !== id ||
        m.createdAt !== record.payload.createdAt ||
        m.expiresAt !== record.payload.expiresAt ||
        m.consistentPointAt !== record.payload.consistentPointAt ||
        Date.parse(m.expiresAt) - Date.parse(m.createdAt) !== life ||
        !Array.isArray(m.objects) ||
        m.objects.length !== record.payload.objectCount ||
        !/^[_a-z][_a-z0-9]{0,62}$/.test(m.schema)
      )
        throw new Error('Invalid backup manifest')
      const seen = new Set<string>()
      for (const v of m.objects) {
        if (
          !uuid.test(v.id) ||
          !/^objects\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(v.objectKey) ||
          !/^object-[0-9]+$/.test(v.part) ||
          !/^[0-9a-f]{64}$/.test(v.sha256) ||
          !Number.isSafeInteger(v.byteSize) ||
          v.byteSize <= 0 ||
          v.byteSize > 500_000_000 ||
          seen.has(v.part) ||
          seen.has(v.objectKey)
        )
          throw new Error('Invalid object manifest')
        seen.add(v.part)
        seen.add(v.objectKey)
      }
      return m
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
  async expire() {
    await privateRoot(this.root)
    let removed = 0
    for (const b of await this.ledger.records('backup_prepared')) {
      if (!uuid.test(b.key) || this.now().getTime() < Date.parse(String(b.payload.expiresAt)))
        continue
      const folder = join(this.root, b.key)
      await rm(folder, { recursive: true, force: true })
      await syncBackupDirectory(this.root)
      if (!(await this.ledger.find('backup_deleted', b.key))) {
        await this.ledger.append('backup_deleted', b.key, {
          id: b.key,
          deletedAt: this.now().toISOString(),
          expiresAt: b.payload.expiresAt
        })
        removed++
      }
    }
    return { removed }
  }
}
