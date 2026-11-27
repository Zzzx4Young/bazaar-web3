import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, mkdir, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import type { PrismaClient } from '../generated/prisma/client.js'
import { privateRoot } from '../delivery-files/private-backup.js'
import { syncBackupDirectory } from '../delivery-files/backup-crypto.js'
import { stable } from '../web3/chain-observer.js'
import { readSignedCheckpoint } from './recovery-authority.js'
import { LedgerWitness } from './ledger-witness.js'
type Namespace = 'wallet' | 'private-files'
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex')
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
async function read(path: string, optional = false): Promise<Buffer | null> {
  let file
  try {
    if (resolve(path) !== path || (await realpath(path)) !== path)
      throw new Error('UNSAFE_RECOVERY_FILE')
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const s = await file.stat()
    if (!s.isFile() || s.uid !== process.getuid?.() || s.mode & 0o077 || s.size > 16384)
      throw new Error('UNSAFE_RECOVERY_FILE')
    return await file.readFile()
  } catch (e) {
    if (optional && (e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  } finally {
    await file?.close()
  }
}
function within(root: string, path: string) {
  const r = relative(root, path)
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
}
async function write(path: string, data: unknown) {
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await file.writeFile(JSON.stringify(data))
    await file.sync()
  } finally {
    await file.close()
  }
}
export interface RecoveryStageOptions {
  client: PrismaClient
  ledgerId: string
  namespace: Namespace
  sourceDirectory: string
  checkpointFile: string
  targetDirectory: string
  environmentId: string
  publicKeyFile: string
  outcome: 'head' | 'before' | 'after'
}
// Only produces an offline candidate. Latest checkpoint custody is an EXTERNAL
// prerequisite; a second same-host directory does not establish monotonic freshness.
export async function stageWitnessRecovery(o: RecoveryStageOptions) {
  if (
    !uuid.test(o.ledgerId) ||
    !['wallet', 'private-files'].includes(o.namespace) ||
    !['head', 'before', 'after'].includes(o.outcome)
  )
    throw new Error('INVALID_CHECKPOINT')
  await privateRoot(o.sourceDirectory)
  await privateRoot(dirname(o.targetDirectory))
  if (
    resolve(o.targetDirectory) !== o.targetDirectory ||
    within(o.sourceDirectory, o.targetDirectory) ||
    within(o.targetDirectory, o.sourceDirectory) ||
    within(o.sourceDirectory, o.checkpointFile) ||
    within(o.targetDirectory, o.checkpointFile)
  )
    throw new Error('INDEPENDENT_CUSTODY_REQUIRED')
  const verified = await readSignedCheckpoint(o),
    p = verified.payload
  if ((o.outcome === 'head') !== !p.pending) throw new Error('INVALID_CHECKPOINT')
  const selected = o.outcome === 'head' ? p.head : p.pending![o.outcome]
  const witness = new LedgerWitness(o.client, o.ledgerId, o.sourceDirectory, o.namespace)
  return witness.withOwnerRecoverySnapshot(async (digest) => {
    if (digest !== selected.digest) throw new Error('CHECKPOINT_MISMATCH')
    const original = await read(join(o.sourceDirectory, 'head.json'), true),
      pending = await read(join(o.sourceDirectory, 'pending.json'), true)
    if (p.pending) {
      if (!pending || stable(JSON.parse(pending.toString())) !== stable(p.pending))
        throw new Error('CHECKPOINT_MISMATCH')
      if (
        !original ||
        ![stable(p.pending.before), stable(p.pending.after)].includes(
          stable(JSON.parse(original.toString()))
        )
      )
        throw new Error('CHECKPOINT_MISMATCH')
    } else if (pending) throw new Error('PENDING_REQUIRES_EXACT_CHECKPOINT')
    const basis = {
      checkpointHash: verified.hash,
      sourceDirectory: o.sourceDirectory,
      outcome: o.outcome,
      ledgerId: o.ledgerId,
      namespace: o.namespace,
      directory: o.targetDirectory,
      head: selected,
      sourceHeadHash: original ? sha(original) : null,
      sourcePendingHash: pending ? sha(pending) : null
    }
    let created = false
    try {
      try {
        await mkdir(o.targetDirectory, { mode: 0o700 })
        created = true
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
      await privateRoot(o.targetDirectory)
      if (!created) {
        const receipt = JSON.parse(
          (await read(join(o.targetDirectory, 'recovery.json')))!.toString()
        )
        if (
          stable(receipt.basis) !== stable(basis) ||
          stable(JSON.parse((await read(join(o.targetDirectory, 'head.json')))!.toString())) !==
            stable(selected)
        )
          throw new Error('RECOVERY_TARGET_CONFLICT')
        return {
          recoveryId: String(receipt.recoveryId),
          directory: o.targetDirectory,
          status: 'candidate' as const,
          applicationOpened: false as const
        }
      }
      const recoveryId = randomUUID()
      await write(join(o.targetDirectory, 'head.json'), selected)
      await write(join(o.targetDirectory, 'recovery.json'), {
        version: 1,
        recoveryId,
        status: 'candidate',
        applicationOpened: false,
        createdAt: new Date().toISOString(),
        basis
      })
      await syncBackupDirectory(o.targetDirectory)
      await syncBackupDirectory(dirname(o.targetDirectory))
      // Original lock/head/pending and all database records remain untouched.
      return {
        recoveryId,
        directory: o.targetDirectory,
        status: 'candidate' as const,
        applicationOpened: false as const
      }
    } catch (e) {
      if (created) await rm(o.targetDirectory, { recursive: true, force: true })
      throw e
    }
  })
}
