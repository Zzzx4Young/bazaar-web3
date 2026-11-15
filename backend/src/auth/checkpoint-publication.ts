import { readSignedCheckpoint, type CheckpointOptions } from './recovery-authority.js'
import { validatePublicationEntry } from './publication-outbox.js'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv
} from 'node:crypto'
import { constants } from 'node:fs'
import { open, lstat, realpath, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stable } from '../web3/chain-observer.js'
import { syncBackupDirectory } from '../delivery-files/backup-crypto.js'

export interface PublicationRecord {
  version: 1
  environmentId: string
  namespace: 'wallet' | 'private-files' | 'recovery-authorizations'
  ledgerId: string
  sequence: number
  digest: string
  records: Record<string, string[]>
}
interface LedgerPosition {
  namespace: PublicationRecord['namespace']
  ledgerId: string
  sequence: number
  digest: string
}
interface PublicationOrigin extends LedgerPosition {
  checkpointHash: string
}
interface PublicationCheckpoint {
  version: 1
  kind: 'recovery-publication'
  environmentId: string
  configurationVersion: string
  ordinal: number
  parentHash: string | null
  entryHash: string
  encryptedHash: string
  ledgers: LedgerPosition[]
  origins?: PublicationOrigin[]
}
export interface PublicationReceipt {
  checkpointHash: string
  checkpoint: PublicationCheckpoint
}
interface Options {
  directory: string
  publicKeyFile: string
  privateKeyFile: string
  encryptionKey: Buffer
  environmentId: string
  configurationVersion: string
  baselineCheckpoints?: CheckpointOptions[]
}
const context = 'bazaar-recovery-publication-v1\n'
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')
const keyOf = (r: Pick<LedgerPosition, 'namespace' | 'ledgerId'>) => r.namespace + ':' + r.ledgerId
const name = (n: number) => 'checkpoint-' + String(n).padStart(12, '0')
async function read(path: string, limit: number) {
  if (resolve(path) !== path || (await realpath(path)) !== path)
    throw new Error('UNSAFE_PUBLICATION_PATH')
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const s = await f.stat()
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.mode & 0o077 ||
      s.uid !== process.getuid?.() ||
      s.size > limit
    )
      throw new Error('UNSAFE_PUBLICATION_FILE')
    const bytes = await f.readFile()
    if (bytes.length > limit) throw new Error('PUBLICATION_BUDGET')
    return bytes
  } finally {
    await f.close()
  }
}
async function write(path: string, bytes: string | Buffer) {
  const f = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await f.writeFile(bytes)
    await f.sync()
  } finally {
    await f.close()
  }
}
function validate(r: PublicationRecord, environmentId: string) {
  if (r.namespace === 'recovery-authorizations') {
    const rows = r.records?.RecoveryAuthorizationReceipt
    if (
      r.version !== 1 ||
      r.sequence !== 0 ||
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      Object.keys(r.records).join(',') !== 'RecoveryAuthorizationReceipt'
    )
      throw new Error('INVALID_CONSUMPTION_PUBLICATION')
    const receipt = JSON.parse(rows[0])
    if (
      receipt.nonce !== r.ledgerId ||
      receipt.environmentId !== r.environmentId ||
      receipt.version !== 1 ||
      receipt.status !== 'consumed' ||
      !/^[0-9a-f-]{36}$/.test(receipt.recoveryId) ||
      !/^[0-9a-f]{64}$/.test(receipt.authorizationHash) ||
      !/^[0-9a-f]{64}$/.test(receipt.checkpointHash) ||
      typeof receipt.configurationVersion !== 'string' ||
      !Number.isFinite(Date.parse(receipt.consumedAt)) ||
      stable(receipt) !== rows[0] ||
      sha('bazaar-recovery-consumption-v1\n' + rows[0]) !== r.digest
    )
      throw new Error('INVALID_CONSUMPTION_PUBLICATION')
  } else validatePublicationEntry(r)
  if (r.environmentId !== environmentId) throw new Error('PUBLICATION_ENVIRONMENT')
  if (
    r.version !== 1 ||
    !['wallet', 'private-files', 'recovery-authorizations'].includes(r.namespace) ||
    !/^[0-9a-f-]{36}$/.test(r.ledgerId) ||
    !Number.isSafeInteger(r.sequence) ||
    r.sequence < 0 ||
    !/^[a-f0-9]{64}$/.test(r.digest) ||
    !r.records ||
    Array.isArray(r.records) ||
    !Object.keys(r.records).length ||
    Object.entries(r.records).some(
      ([k, v]) =>
        !/^[A-Za-z][A-Za-z0-9]+$/.test(k) ||
        !Array.isArray(v) ||
        v.some((x) => typeof x !== 'string')
    )
  )
    throw new Error('INVALID_PUBLICATION_RECORD')
  if (Buffer.byteLength(stable(r)) > 16000000) throw new Error('PUBLICATION_BUDGET')
}
function advance(
  positions: LedgerPosition[],
  entry: PublicationRecord,
  baselines: PublicationOrigin[]
) {
  const previous = positions.find((x) => keyOf(x) === keyOf(entry))
  const baseline = baselines.find((x) => keyOf(x) === keyOf(entry))
  if (entry.sequence !== (previous ? previous.sequence + 1 : (baseline?.sequence ?? 0)))
    throw new Error('PUBLICATION_GAP')
  if (!previous && baseline && entry.digest !== baseline.digest)
    throw new Error('PUBLICATION_BASELINE_MISMATCH')
  return [
    ...positions.filter((x) => keyOf(x) !== keyOf(entry)),
    {
      namespace: entry.namespace,
      ledgerId: entry.ledgerId,
      sequence: entry.sequence,
      digest: entry.digest
    }
  ].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
}
/** Privileged local custody simulation. Runtime receives no signing/decryption
 * keys. Immutable encrypted snapshots precede signed checkpoints; no mutable latest
 * pointer is trusted. Missing tail cannot be detected without retained external evidence. */
export class LocalCheckpointPublicationStore {
  constructor(private readonly o: Options) {
    if (
      o.encryptionKey.length !== 32 ||
      !/^[a-zA-Z0-9._:-]{1,128}$/.test(o.environmentId) ||
      !/^[a-zA-Z0-9._:-]{1,128}$/.test(o.configurationVersion)
    )
      throw new Error('INVALID_PUBLICATION_CONFIGURATION')
  }
  private async root() {
    const s = await lstat(this.o.directory)
    if (
      resolve(this.o.directory) !== this.o.directory ||
      (await realpath(this.o.directory)) !== this.o.directory ||
      !s.isDirectory() ||
      s.uid !== process.getuid?.() ||
      s.mode & 0o077
    )
      throw new Error('UNSAFE_PUBLICATION_DIRECTORY')
  }
  private async baselines(): Promise<PublicationOrigin[]> {
    const origins: PublicationOrigin[] = []
    for (const pin of this.o.baselineCheckpoints ?? []) {
      if (pin.environmentId !== this.o.environmentId || pin.publicKeyFile !== this.o.publicKeyFile)
        throw new Error('PUBLICATION_BASELINE_AUTHORITY')
      const { payload, hash } = await readSignedCheckpoint(pin)
      if (
        payload.pending ||
        payload.head.sequence <= 0 ||
        origins.some((x) => keyOf(x) === keyOf(payload))
      )
        throw new Error('PUBLICATION_BASELINE_CONFLICT')
      origins.push({
        namespace: payload.namespace,
        ledgerId: payload.ledgerId,
        sequence: payload.head.sequence,
        digest: payload.head.digest,
        checkpointHash: hash
      })
    }
    return origins.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  }
  async recover(): Promise<{ entries: PublicationRecord[]; receipts: PublicationReceipt[] }> {
    await this.root()
    const baselines = await this.baselines()
    const key = createPublicKey(await read(this.o.publicKeyFile, 16384))
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('INVALID_PUBLICATION_KEY')
    const files = (await readdir(this.o.directory)).filter((x) => !x.startsWith('.staging-')).sort()
    if (files.length > 1000 || files.some((x, i) => x !== name(i)))
      throw new Error('PUBLICATION_CHAIN_GAP')
    const entries: PublicationRecord[] = [],
      receipts: PublicationReceipt[] = []
    let positions: LedgerPosition[] = [],
      parentHash: string | null = null
    for (const [i, file] of files.entries()) {
      const directory = join(this.o.directory, file),
        s = await lstat(directory)
      if (
        !s.isDirectory() ||
        s.mode & 0o077 ||
        s.uid !== process.getuid?.() ||
        (await realpath(directory)) !== directory
      )
        throw new Error('UNSAFE_PUBLICATION_DIRECTORY')
      const docBytes = await read(join(directory, 'checkpoint.json'), 100000),
        doc = JSON.parse(docBytes.toString()),
        p = doc.payload as PublicationCheckpoint
      if (
        !p ||
        typeof doc.signature !== 'string' ||
        !verify(null, Buffer.from(context + stable(p)), key, Buffer.from(doc.signature, 'base64'))
      )
        throw new Error('PUBLICATION_SIGNATURE')
      if (
        p.version !== 1 ||
        p.kind !== 'recovery-publication' ||
        p.environmentId !== this.o.environmentId ||
        p.configurationVersion !== this.o.configurationVersion ||
        p.ordinal !== i ||
        p.parentHash !== parentHash
      )
        throw new Error('PUBLICATION_CHECKPOINT_MISMATCH')
      const encrypted = await read(join(directory, 'records.enc'), 16000028)
      if (encrypted.length < 28 || sha(encrypted) !== p.encryptedHash)
        throw new Error('PUBLICATION_MATERIAL_MISSING')
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.o.encryptionKey,
        encrypted.subarray(0, 12)
      )
      decipher.setAAD(
        Buffer.from(
          context + this.o.environmentId + '\n' + this.o.configurationVersion + '\n' + p.entryHash
        )
      )
      decipher.setAuthTag(encrypted.subarray(-16))
      const plain = Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()])
      let entry: PublicationRecord
      try {
        entry = JSON.parse(plain.toString())
        validate(entry, this.o.environmentId)
        if (sha(stable(entry)) !== p.entryHash) throw new Error('PUBLICATION_MATERIAL_MISMATCH')
      } finally {
        plain.fill(0)
      }
      positions = advance(positions, entry, baselines)
      const origins = baselines.filter((b) => positions.some((x) => keyOf(x) === keyOf(b)))
      if (stable(p.origins ?? []) !== stable(origins))
        throw new Error('PUBLICATION_BASELINE_MISMATCH')
      if (stable(positions) !== stable(p.ledgers)) throw new Error('PUBLICATION_VECTOR_MISMATCH')
      parentHash = sha(docBytes)
      entries.push(entry)
      receipts.push({ checkpointHash: parentHash, checkpoint: p })
    }
    return { entries, receipts }
  }
  async publish(entry: PublicationRecord): Promise<PublicationReceipt> {
    validate(entry, this.o.environmentId)
    const current = await this.recover(),
      entryHash = sha(stable(entry)),
      matching = current.entries.findIndex(
        (x) => keyOf(x) === keyOf(entry) && x.sequence === entry.sequence
      )
    if (matching >= 0) {
      if (sha(stable(current.entries[matching])) !== entryHash)
        throw new Error('PUBLICATION_CONFLICT')
      await syncBackupDirectory(this.o.directory)
      const confirmed = await this.recover()
      if (
        confirmed.receipts[matching]?.checkpointHash !== current.receipts[matching].checkpointHash
      )
        throw new Error('PUBLICATION_READBACK_MISMATCH')
      return confirmed.receipts[matching]
    }
    const baselines = await this.baselines()
    const previous = current.receipts.at(-1),
      positions = advance(previous?.checkpoint.ledgers ?? [], entry, baselines),
      ordinal = current.entries.length
    if (ordinal >= 1000) throw new Error('PUBLICATION_BUDGET')
    const signer = createPrivateKey(await read(this.o.privateKeyFile, 16384)),
      pinned = createPublicKey(await read(this.o.publicKeyFile, 16384))
    if (
      signer.asymmetricKeyType !== 'ed25519' ||
      !createPublicKey(signer)
        .export({ format: 'der', type: 'spki' })
        .equals(pinned.export({ format: 'der', type: 'spki' }))
    )
      throw new Error('PUBLICATION_AUTHORITY_MISMATCH')
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.o.encryptionKey, iv)
    cipher.setAAD(
      Buffer.from(
        context + this.o.environmentId + '\n' + this.o.configurationVersion + '\n' + entryHash
      )
    )
    const plain = Buffer.from(stable(entry))
    let encrypted: Buffer
    try {
      encrypted = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
    } finally {
      plain.fill(0)
    }
    const payload: PublicationCheckpoint = {
      version: 1,
      kind: 'recovery-publication',
      environmentId: this.o.environmentId,
      configurationVersion: this.o.configurationVersion,
      ordinal,
      parentHash: previous?.checkpointHash ?? null,
      entryHash,
      encryptedHash: sha(encrypted),
      ledgers: positions,
      ...(baselines.length
        ? { origins: baselines.filter((b) => positions.some((x) => keyOf(x) === keyOf(b))) }
        : {})
    }
    const document = JSON.stringify({
      payload,
      signature: sign(null, Buffer.from(context + stable(payload)), signer).toString('base64')
    })
    const temporary = join(this.o.directory, '.staging-' + randomUUID()),
      target = join(this.o.directory, name(ordinal))
    await mkdir(temporary, { mode: 0o700 })
    try {
      await write(join(temporary, 'records.enc'), encrypted)
      await write(join(temporary, 'checkpoint.json'), document)
      await syncBackupDirectory(temporary)
      try {
        await rename(temporary, target)
      } catch (e) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e
        const winner = await this.recover(),
          at = winner.entries.findIndex(
            (x) => keyOf(x) === keyOf(entry) && x.sequence === entry.sequence
          )
        if (at < 0 || sha(stable(winner.entries[at])) !== entryHash)
          throw new Error('PUBLICATION_CONFLICT', { cause: e })
        await syncBackupDirectory(this.o.directory)
        const confirmed = await this.recover()
        if (confirmed.receipts[at]?.checkpointHash !== winner.receipts[at].checkpointHash)
          throw new Error('PUBLICATION_READBACK_MISMATCH', { cause: e })
        return confirmed.receipts[at]
      }
      await syncBackupDirectory(this.o.directory)
      // Read/decrypt/verify from custody, never acknowledge merely prepared bytes.
      const confirmed = await this.recover()
      return confirmed.receipts[ordinal]
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
}
