import { constants } from 'node:fs'
import { open, lstat, realpath, mkdir, unlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import type { PrismaClient } from '../generated/prisma/client.js'
import { LedgerWitness } from './ledger-witness.js'
import {
  readSignedCheckpoint,
  createWitnessCheckpointGuard,
  type CheckpointOptions
} from './recovery-authority.js'
import {
  appendPublication,
  capturePublication,
  verifyPublicationHead
} from './publication-outbox.js'
import { stable } from '../web3/chain-observer.js'
import { privateRoot } from '../delivery-files/private-backup.js'
import { syncBackupDirectory } from '../delivery-files/backup-crypto.js'

export interface PublicationEnrollmentOptions {
  client: PrismaClient
  ledgerId: string
  namespace: 'wallet' | 'private-files'
  sourceDirectory: string
  targetDirectory: string
  environmentId: string
  checkpoint: CheckpointOptions
}
async function read(path: string) {
  if (resolve(path) !== path || (await realpath(path)) !== path)
    throw new Error('UNSAFE_ENROLLMENT_FILE')
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const s = await f.stat()
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid?.() ||
      s.mode & 0o077 ||
      s.size > 16384
    )
      throw new Error('UNSAFE_ENROLLMENT_FILE')
    return JSON.parse(await f.readFile('utf8')) as unknown
  } finally {
    await f.close()
  }
}
async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}
async function write(path: string, value: unknown) {
  const f = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await f.writeFile(JSON.stringify(value))
    await f.sync()
  } finally {
    await f.close()
  }
}
function within(root: string, path: string) {
  const r = relative(root, path)
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
}
/** Owner maintenance only. Callers stop all consumers before staging/activation.
 * Source custody stays unchanged. Candidate pending marker spans the DB commit;
 * incomplete/uncertain attempts are never runtime-readable or silently resealed. */
export async function enrollPublication(o: PublicationEnrollmentOptions) {
  if (
    o.checkpoint.environmentId !== o.environmentId ||
    o.checkpoint.ledgerId !== o.ledgerId ||
    o.checkpoint.namespace !== o.namespace ||
    !o.checkpoint.historyFile
  )
    throw new Error('ENROLLMENT_CHECKPOINT_REQUIRED')
  await privateRoot(o.sourceDirectory)
  await privateRoot(dirname(o.targetDirectory))
  if (
    resolve(o.targetDirectory) !== o.targetDirectory ||
    within(o.sourceDirectory, o.targetDirectory) ||
    within(o.targetDirectory, o.sourceDirectory) ||
    [o.checkpoint.checkpointFile, o.checkpoint.publicKeyFile, o.checkpoint.historyFile].some(
      (p) => within(o.sourceDirectory, p) || within(o.targetDirectory, p)
    )
  )
    throw new Error('INDEPENDENT_CUSTODY_REQUIRED')
  const verified = await readSignedCheckpoint(o.checkpoint),
    p = verified.payload
  if (p.pending || !p.historyHash || p.head.sequence <= 0)
    throw new Error('ENROLLMENT_CHECKPOINT_REQUIRED')
  const baseline = {
    sequence: p.head.sequence,
    digest: p.head.digest,
    checkpointHash: verified.hash
  }
  const head = {
    ...p.head,
    publicationEnvironmentId: o.environmentId,
    publicationBaseline: baseline
  }
  const basis = {
    version: 1,
    checkpointHash: verified.hash,
    sourceDirectory: o.sourceDirectory,
    targetDirectory: o.targetDirectory,
    namespace: o.namespace,
    environmentId: o.environmentId,
    head
  }
  const result = {
    directory: o.targetDirectory,
    status: 'candidate' as const,
    sequence: p.head.sequence,
    checkpointHash: verified.hash,
    applicationOpened: false as const
  }
  async function source() {
    if (
      (await exists(join(o.sourceDirectory, 'lock'))) ||
      (await exists(join(o.sourceDirectory, 'pending.json')))
    )
      throw new Error('STOPPED_WRITER_REQUIRED')
    if (stable(await read(join(o.sourceDirectory, 'head.json'))) !== stable(p.head))
      throw new Error('ENROLLMENT_HEAD_MISMATCH')
  }
  await source()
  const witness = new LedgerWitness(o.client, o.ledgerId, o.sourceDirectory, o.namespace)
  await witness.withOwnerRecoverySnapshot(
    async (digest, tx) => {
      await source()
      if (digest !== p.head.digest) throw new Error('ENROLLMENT_DATABASE_MISMATCH')
      await createWitnessCheckpointGuard(o.checkpoint, { ownerInspection: true })(p.head, tx)
      // Sequence state is not MVCC-versioned. A legacy transaction whose RR
      // snapshot predates this commit must still see activation after its lock wait.
      // A rollback leaves activation set, so uncertain enrollment cannot reopen legacy access.
      await tx.$queryRaw`SELECT nextval('"LedgerPublicationFence"'::regclass)`
      // Publication tables must already exist. Maintenance never creates or repairs schema.
      await tx.$executeRawUnsafe(
        'LOCK TABLE "LedgerPublicationOutbox", "LedgerPublicationReceipt" IN ACCESS EXCLUSIVE MODE NOWAIT'
      )
      const entry = await capturePublication(tx, {
        environmentId: o.environmentId,
        namespace: o.namespace,
        ledgerId: o.ledgerId,
        sequence: p.head.sequence,
        digest
      })
      const rows = await tx.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*)::bigint AS count FROM "LedgerPublicationOutbox"`
      const receipts = await tx.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*)::bigint AS count FROM "LedgerPublicationReceipt"`
      let created = false
      try {
        await mkdir(o.targetDirectory, { mode: 0o700 })
        created = true
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
      await privateRoot(o.targetDirectory)
      if (created) {
        if (rows[0].count || receipts[0].count) throw new Error('ENROLLMENT_QUEUE_CONFLICT')
        // Keep partial candidates on every failure; retries require all exact evidence.
        await write(join(o.targetDirectory, 'pending.json'), basis)
        await syncBackupDirectory(o.targetDirectory)
        await syncBackupDirectory(dirname(o.targetDirectory))
        await write(join(o.targetDirectory, 'head.json'), head)
        await write(join(o.targetDirectory, 'enrollment.json'), basis)
        await syncBackupDirectory(o.targetDirectory)
        await syncBackupDirectory(dirname(o.targetDirectory))
      } else {
        if (
          stable(await read(join(o.targetDirectory, 'enrollment.json'))) !== stable(basis) ||
          stable(await read(join(o.targetDirectory, 'head.json'))) !== stable(head) ||
          (await exists(join(o.targetDirectory, 'lock')))
        )
          throw new Error('ENROLLMENT_TARGET_CONFLICT')
        const pending = await exists(join(o.targetDirectory, 'pending.json'))
        if (
          pending &&
          stable(await read(join(o.targetDirectory, 'pending.json'))) !== stable(basis)
        )
          throw new Error('ENROLLMENT_TARGET_CONFLICT')
        // Exact complete candidate + durable ambiguity marker may resume a
        // rolled-back insert. An already activated candidate may never refill
        // a missing baseline, and partial/foreign queues are never adopted.
        const rolledBack = pending && rows[0].count === 0n && receipts[0].count === 0n
        if (!rolledBack && (rows[0].count !== 1n || receipts[0].count > 1n))
          throw new Error('ENROLLMENT_QUEUE_CONFLICT')
      }
      await appendPublication(tx, entry)
      await verifyPublicationHead(tx, head, o.namespace, o.environmentId, baseline)
      await source()
    },
    { stoppedWriter: true }
  )
  // Only a confirmed exact DB commit can clear the candidate's ambiguity marker.
  if (await exists(join(o.targetDirectory, 'pending.json')))
    await unlink(join(o.targetDirectory, 'pending.json'))
  await syncBackupDirectory(o.targetDirectory)
  await syncBackupDirectory(dirname(o.targetDirectory))
  return result
}
