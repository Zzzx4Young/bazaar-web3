import { constants } from 'node:fs'
import { open, realpath, readdir } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

export interface RecoveryConsumptionReceipt {
  nonce: string
  authorizationHash: string
  recoveryId: string
  checkpointHash: string
  configurationVersion: string
  consumedAt: string
}
export interface RecoveryConsumptionGuard {
  consume(receipt: RecoveryConsumptionReceipt): Promise<void>
}
export interface RecoveryConsumptionSnapshot extends RecoveryConsumptionReceipt {
  version: 1
  status: 'consumed'
  environmentId: string
}
export interface LocalRecoveryAuthorizationJournalOptions {
  /** Pre-provisioned private custody directory, retained outside receipt rollback. */
  directory: string
  usedDirectory: string
  binding: {
    environmentId: string
    recoveryId: string
    checkpointHash: string
    configurationVersion: string
  }
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
const hex = /^[0-9a-f]{64}$/
const identifier = /^[a-zA-Z0-9._:-]{1,128}$/
const receiptKeys = [
  'nonce',
  'authorizationHash',
  'recoveryId',
  'checkpointHash',
  'configurationVersion',
  'consumedAt'
]
function validReceipt(r: RecoveryConsumptionReceipt) {
  return (
    r &&
    receiptKeys.every((k) => typeof (r as unknown as Record<string, unknown>)[k] === 'string') &&
    uuid.test(r.nonce) &&
    uuid.test(r.recoveryId) &&
    hex.test(r.authorizationHash) &&
    hex.test(r.checkpointHash) &&
    identifier.test(r.configurationVersion) &&
    typeof r.consumedAt === 'string' &&
    Number.isFinite(Date.parse(r.consumedAt)) &&
    new Date(r.consumedAt).toISOString() === r.consumedAt
  )
}
function overlaps(a: string, b: string) {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep)
}
/**
 * Local Linux custody journal: immutable exclusive files, one per nonce. This is
 * a distinct rollback domain, not independent-host or privileged-owner protection.
 * Never remove a reservation on failure, including an uncertain fsync/acknowledgement.
 */
export class LocalRecoveryAuthorizationJournal implements RecoveryConsumptionGuard {
  private readonly options: LocalRecoveryAuthorizationJournalOptions
  constructor(options: LocalRecoveryAuthorizationJournalOptions) {
    this.options = { ...options, binding: { ...options.binding } }
    const { directory, usedDirectory, binding } = this.options
    if (
      resolve(directory) !== directory ||
      resolve(usedDirectory) !== usedDirectory ||
      overlaps(directory, usedDirectory) ||
      directory === '/' ||
      usedDirectory === '/'
    )
      throw new Error('UNSAFE_RECOVERY_CONSUMPTION_JOURNAL')
    if (
      Object.values(binding).some((value) => typeof value !== 'string') ||
      !identifier.test(binding.environmentId) ||
      !uuid.test(binding.recoveryId) ||
      !hex.test(binding.checkpointHash) ||
      !identifier.test(binding.configurationVersion)
    )
      throw new Error('INVALID_RECOVERY_CONSUMPTION_BINDING')
  }
  private async directory(): Promise<FileHandle> {
    const path = this.options.directory
    if ((await realpath(path)) !== path) throw new Error('UNSAFE_RECOVERY_CONSUMPTION_JOURNAL')
    const directory = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try {
      const s = await directory.stat()
      if (!s.isDirectory() || s.uid !== process.getuid?.() || s.mode & 0o077)
        throw new Error('UNSAFE_RECOVERY_CONSUMPTION_JOURNAL')
      // Check the other rollback domain's canonical location too. It need not be
      // present when snapshots are read, but symlink aliases must never overlap.
      const used = await realpath(this.options.usedDirectory).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return this.options.usedDirectory
        throw e
      })
      if (used !== this.options.usedDirectory || overlaps(path, used))
        throw new Error('UNSAFE_RECOVERY_CONSUMPTION_JOURNAL')
      return directory
    } catch (e) {
      await directory.close()
      throw e
    }
  }
  async consume(receipt: RecoveryConsumptionReceipt): Promise<void> {
    if (!validReceipt(receipt) || Object.keys(receipt).some((k) => !receiptKeys.includes(k)))
      throw new Error('INVALID_RECOVERY_CONSUMPTION_RECEIPT')
    const { binding } = this.options
    if (
      receipt.recoveryId !== binding.recoveryId ||
      receipt.checkpointHash !== binding.checkpointHash ||
      receipt.configurationVersion !== binding.configurationVersion
    )
      throw new Error('RECOVERY_CONSUMPTION_BINDING_MISMATCH')
    const snapshot: RecoveryConsumptionSnapshot = {
      ...receipt,
      version: 1,
      status: 'consumed',
      environmentId: binding.environmentId
    }
    const directory = await this.directory()
    try {
      let file: FileHandle
      try {
        // Pin lookup to the already opened directory even if its pathname moves.
        file = await open(
          `/proc/self/fd/${directory.fd}/${receipt.nonce}`,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600
        )
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('RECOVERY_AUTHORIZATION_CONSUMED', { cause: e })
        throw e
      }
      try {
        await file.writeFile(JSON.stringify(snapshot))
        await file.sync()
      } finally {
        await file.close()
      }
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
  /** Validated receipt copies for the parent's signed publication; never repairs entries. */
  async readReceipts(): Promise<RecoveryConsumptionSnapshot[]> {
    const directory = await this.directory()
    try {
      const root = `/proc/self/fd/${directory.fd}`
      const names = (await readdir(root)).sort()
      if (names.length > 10000) throw new Error('RECOVERY_CONSUMPTION_JOURNAL_LIMIT')
      const result: RecoveryConsumptionSnapshot[] = []
      for (const name of names) {
        if (!uuid.test(name)) throw new Error('UNSAFE_RECOVERY_CONSUMPTION_RECEIPT')
        const file = await open(
          `${root}/${name}`,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        )
        try {
          const s = await file.stat()
          if (
            !s.isFile() ||
            s.uid !== process.getuid?.() ||
            s.mode & 0o077 ||
            s.nlink !== 1 ||
            s.size > 4096
          )
            throw new Error('UNSAFE_RECOVERY_CONSUMPTION_RECEIPT')
          const bytes = Buffer.alloc(4097)
          let length = 0
          while (length < bytes.length) {
            const r = await file.read(bytes, length, bytes.length - length, null)
            if (!r.bytesRead) break
            length += r.bytesRead
          }
          if (length > 4096) throw new Error('UNSAFE_RECOVERY_CONSUMPTION_RECEIPT')
          const r = JSON.parse(bytes.subarray(0, length).toString()) as RecoveryConsumptionSnapshot
          if (
            !validReceipt(r) ||
            r.version !== 1 ||
            r.status !== 'consumed' ||
            r.nonce !== name ||
            Object.keys(r).some(
              (k) => ![...receiptKeys, 'version', 'status', 'environmentId'].includes(k)
            )
          )
            throw new Error('INVALID_RECOVERY_CONSUMPTION_RECEIPT')
          if (r.environmentId !== this.options.binding.environmentId)
            throw new Error('RECOVERY_CONSUMPTION_BINDING_MISMATCH')
          result.push(r)
        } finally {
          await file.close()
        }
      }
      return result
    } finally {
      await directory.close()
    }
  }
}
