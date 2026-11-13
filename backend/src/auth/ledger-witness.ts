import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, lstat, realpath, mkdir, rename, unlink, rmdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { ChainVerificationError } from '../web3/chain-observer.js'
import type { Web3Config } from '../web3/web3-types.js'
import { DomainError } from '../common/domain-error.js'

// Deliberately closed schema: adding another authoritative table requires
// adding it here and upgrading the protected witness through a reviewed procedure.
const tables = [
  'WalletLedgerMeta',
  'WalletLedgerAccount',
  'WalletLedgerClaim',
  'WalletLedgerReservation',
  'WalletLedgerOperation',
  'WalletLedgerEvent',
  'PaymentLedgerIntent',
  'PaymentLedgerHead',
  'PaymentLedgerResolution',
  'PaymentLedgerRefundExit'
] as const
interface Head {
  version: 1
  ledgerId: string
  sequence: number
  digest: string
}
type Options = {
  isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable'
  timeout?: number
  maxWait?: number
}
const witnesses = new WeakMap<PrismaClient, LedgerWitness>()
export function registerLedgerWitness(client: PrismaClient, witness: LedgerWitness) {
  if (witness.client !== client || witnesses.has(client))
    throw new Error('Ledger witness already attached')
  witnesses.set(client, witness)
}
export function ledgerTransaction<T>(
  client: PrismaClient,
  work: (tx: Transaction) => Promise<T>,
  options?: Options
) {
  const witness = witnesses.get(client)
  // Direct journal construction is retained for explicit isolated test doubles.
  // Runtime API and worker must register a witness before using these journals.
  return witness ? witness.run(work, options) : client.$transaction(work, options)
}

export class LedgerWitness {
  constructor(
    readonly client: PrismaClient,
    readonly ledgerId: string,
    readonly directory: string
  ) {
    if (
      !isAbsolute(directory) ||
      resolve(directory) !== directory ||
      !/^[0-9a-f-]{36}$/.test(ledgerId)
    )
      throw new Error('Invalid protected witness configuration')
  }
  private unavailable(): never {
    throw new DomainError('WALLET_UNAVAILABLE')
  }
  private async root() {
    const info = await lstat(this.directory)
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      info.mode & 0o077 ||
      (await realpath(this.directory)) !== this.directory
    )
      this.unavailable()
  }
  private async syncDirectory() {
    const dir = await open(
      this.directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try {
      await dir.sync()
    } finally {
      await dir.close()
    }
  }
  private async exists(name: string) {
    try {
      await lstat(join(this.directory, name))
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw e
    }
  }
  private async exclusiveWrite(name: string, data: unknown) {
    const file = await open(
      join(this.directory, name),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    )
    try {
      await file.writeFile(JSON.stringify(data))
      await file.sync()
    } finally {
      await file.close()
    }
    await this.syncDirectory()
  }
  private async head(): Promise<Head> {
    const file = await open(
      join(this.directory, 'head.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    try {
      const s = await file.stat()
      if (!s.isFile() || s.uid !== process.getuid?.() || s.mode & 0o077 || s.size > 4096)
        this.unavailable()
      const h = JSON.parse(await file.readFile('utf8')) as Head
      if (
        h.version !== 1 ||
        h.ledgerId !== this.ledgerId ||
        !Number.isSafeInteger(h.sequence) ||
        h.sequence < 0 ||
        !/^[0-9a-f]{64}$/.test(h.digest)
      )
        this.unavailable()
      return h
    } finally {
      await file.close()
    }
  }
  private async mutex<T>(work: () => Promise<T>): Promise<T> {
    let owned = false
    try {
      await this.root()
      // A crashed owner leaves a lock. Never guess that the database commit
      // rolled back, never remove another process's lock based only on its PID.
      for (let i = 0; i < 100; i++) {
        try {
          await mkdir(join(this.directory, 'lock'), { mode: 0o700 })
          owned = true
          break
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        }
        await delay(20)
      }
      if (!owned) this.unavailable()
      await this.root()
      return await work()
    } catch (e) {
      if (e instanceof DomainError || e instanceof ChainVerificationError) throw e
      return this.unavailable()
    } finally {
      if (owned) await rmdir(join(this.directory, 'lock'))
    }
  }
  private async snapshotLock(tx: Transaction) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('ledger-witness-v1',0))`
    // SELECT privileges suffice; block concurrent DROP/TRUNCATE/restore DDL.
    // RepeatableRead excludes concurrent owner DML from both fingerprints and
    // callback reads, so it can never be mistaken for this transaction's change.
    await tx.$executeRawUnsafe(
      `LOCK TABLE ${tables.map((t) => '"' + t + '"').join(',')} IN ACCESS SHARE MODE`
    )
  }
  private async fingerprint(tx: Transaction) {
    await tx.$queryRaw`SELECT set_config('TimeZone','UTC',true),
      set_config('DateStyle','ISO, YMD',true), set_config('IntervalStyle','iso_8601',true)`
    const [meta] = await tx.$queryRaw<{ ledgerId: string }[]>`
      SELECT "ledgerId" FROM "WalletLedgerMeta" WHERE "singleton"=true`
    if (meta?.ledgerId !== this.ledgerId) this.unavailable()
    const hash = createHash('sha256').update('bazaar-security-ledger-witness-v1\n')
    for (const table of tables) {
      hash.update(table + '\n')
      let after = ''
      for (;;) {
        // PostgreSQL JSON text preserves integer precision. Page without holding
        // the whole ledger in memory; identifiers come only from the closed list.
        const rows = await tx.$queryRawUnsafe<{ row: string }[]>(
          `SELECT to_jsonb(t)::text AS row FROM "${table}" t WHERE to_jsonb(t)::text COLLATE "C" > $1 ORDER BY to_jsonb(t)::text COLLATE "C" LIMIT 128`,
          after
        )
        if (!rows.length) break
        for (const row of rows) hash.update(row.row + '\n')
        after = rows[rows.length - 1].row
      }
    }
    return hash.digest('hex')
  }
  async initializeFresh() {
    return this.mutex(async () => {
      if ((await this.exists('head.json')) || (await this.exists('pending.json')))
        this.unavailable()
      await this.client.$transaction(
        async (tx) => {
          await this.snapshotLock(tx)
          for (const table of tables.slice(1)) {
            const rows = await tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM "${table}" LIMIT 1`)
            if (rows.length) this.unavailable()
          }
          const digest = await this.fingerprint(tx)
          await this.exclusiveWrite('head.json', {
            version: 1,
            ledgerId: this.ledgerId,
            sequence: 0,
            digest
          })
        },
        { isolationLevel: 'RepeatableRead', timeout: 10000 }
      )
    })
  }
  async verify() {
    return this.run(async () => undefined)
  }
  async run<T>(work: (tx: Transaction) => Promise<T>, options: Options = {}): Promise<T> {
    return this.mutex(async () => {
      if (await this.exists('pending.json')) this.unavailable()
      const head = await this.head()
      let next: Head | null = null
      const result = await this.client.$transaction(
        async (tx) => {
          await this.snapshotLock(tx)
          if ((await this.fingerprint(tx)) !== head.digest) this.unavailable()
          const value = await work(tx)
          const digest = await this.fingerprint(tx)
          if (digest !== head.digest) {
            if (head.sequence === Number.MAX_SAFE_INTEGER) this.unavailable()
            next = { ...head, sequence: head.sequence + 1, digest }
            // Durable ambiguity marker precedes DB commit. Any later exception,
            // process crash or uncertain commit leaves protection in place.
            await this.exclusiveWrite('pending.json', { version: 1, before: head, after: next })
          }
          return value
        },
        {
          ...options,
          isolationLevel:
            options.isolationLevel === 'Serializable' ? 'Serializable' : 'RepeatableRead',
          timeout: options.timeout ?? 10000
        }
      )
      if (next) {
        const tmp = 'head-' + randomUUID() + '.tmp'
        await this.exclusiveWrite(tmp, next)
        await rename(join(this.directory, tmp), join(this.directory, 'head.json'))
        await this.syncDirectory()
        await unlink(join(this.directory, 'pending.json'))
        await this.syncDirectory()
      }
      return result
    })
  }
}

export function requireLedgerWitness(
  client: PrismaClient,
  config: Pick<Web3Config, 'securityLedgerId' | 'securityWitnessDirectory'>
) {
  if (!config.securityWitnessDirectory)
    throw new Error(
      'Explicit WEB3_SECURITY_WITNESS_DIR is required; never auto-enrol a restored ledger'
    )
  const witness = new LedgerWitness(
    client,
    config.securityLedgerId,
    config.securityWitnessDirectory
  )
  registerLedgerWitness(client, witness)
  return witness
}
