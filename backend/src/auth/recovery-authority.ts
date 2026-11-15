import type { RecoveryConsumptionGuard } from './recovery-authorization-publication.js'
import { assertRuntimeTrustFiles } from './checkpoint-trust.js'
import type { Transaction } from '../database/transaction.js'
import { verifyCheckpointHistory } from './checkpoint-history.js'
import { createPublicKey, verify, createHash } from 'node:crypto'
import { constants, readFileSync, lstatSync, realpathSync } from 'node:fs'
import { open, realpath, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { stable } from '../web3/chain-observer.js'
import { syncBackupDirectory } from '../delivery-files/backup-crypto.js'
export interface WitnessHead {
  version: 1
  ledgerId: string
  sequence: number
  digest: string
}
export interface CheckpointOptions {
  checkpointFile: string
  publicKeyFile: string
  environmentId: string
  ledgerId: string
  namespace: 'wallet' | 'private-files'
  historyFile?: string
  configurationFile?: string
  pairedPrivateConfigurationFile?: string
}
export interface Checkpoint {
  version: 1
  kind: 'witness-checkpoint'
  checkpointId: string
  environmentId: string
  ledgerId: string
  namespace: 'wallet' | 'private-files'
  head: WitnessHead
  historyHash?: string
  parentCheckpointHash?: string
  pending?: { version: 1; before: WitnessHead; after: WitnessHead }
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/,
  hex = /^[0-9a-f]{64}$/
export const recoveryDocumentContext = 'bazaar-recovery-document-v1\n'
function fields(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw new Error('INVALID_RECOVERY_DOCUMENT')
}
function identifier(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(v))
    throw new Error('INVALID_RECOVERY_DOCUMENT')
}
function head(v: unknown, id: string): asserts v is WitnessHead {
  fields(v, ['version', 'ledgerId', 'sequence', 'digest'])
  if (
    v.version !== 1 ||
    v.ledgerId !== id ||
    typeof v.sequence !== 'number' ||
    !Number.isSafeInteger(v.sequence) ||
    v.sequence < 0 ||
    typeof v.digest !== 'string' ||
    !hex.test(v.digest)
  )
    throw new Error('INVALID_CHECKPOINT')
}
// Public signed documents may be readable by the runtime OS account, but never
// group/world writable. Trust in freshness is provided by custody, not this file.
async function bounded(path: string, limit = 16384) {
  if (resolve(path) !== path || (await realpath(path)) !== path)
    throw new Error('UNSAFE_RECOVERY_DOCUMENT')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const s = await file.stat()
    if (!s.isFile() || s.mode & 0o022 || s.size > limit || s.nlink !== 1)
      throw new Error('UNSAFE_RECOVERY_DOCUMENT')
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const r = await file.read(bytes, length, bytes.length - length, null)
      if (!r.bytesRead) break
      length += r.bytesRead
    }
    if (length > limit) throw new Error('UNSAFE_RECOVERY_DOCUMENT')
    return bytes.subarray(0, length)
  } finally {
    await file.close()
  }
}
async function signed(file: string, publicKeyFile: string) {
  const bytes = await bounded(file),
    e: unknown = JSON.parse(bytes.toString())
  fields(e, ['payload', 'signature'])
  if (typeof e.signature !== 'string' || !/^[a-zA-Z0-9+/]{86}==$/.test(e.signature))
    throw new Error('INVALID_RECOVERY_SIGNATURE')
  const key = createPublicKey(await bounded(publicKeyFile))
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      Buffer.from(recoveryDocumentContext + stable(e.payload)),
      key,
      Buffer.from(e.signature, 'base64')
    )
  )
    throw new Error('INVALID_RECOVERY_SIGNATURE')
  return { payload: e.payload, hash: createHash('sha256').update(bytes).digest('hex') }
}
export async function readSignedCheckpoint(o: CheckpointOptions) {
  const result = await signed(o.checkpointFile, o.publicKeyFile),
    v = result.payload
  fields(v, [
    'version',
    'kind',
    'checkpointId',
    'environmentId',
    'ledgerId',
    'namespace',
    'head',
    'pending',
    'historyHash',
    'parentCheckpointHash'
  ])
  if (
    v.version !== 1 ||
    v.kind !== 'witness-checkpoint' ||
    v.environmentId !== o.environmentId ||
    v.ledgerId !== o.ledgerId ||
    v.namespace !== o.namespace ||
    typeof v.checkpointId !== 'string' ||
    !uuid.test(v.checkpointId)
  )
    throw new Error('INVALID_CHECKPOINT')
  for (const h of [v.historyHash, v.parentCheckpointHash])
    if (h !== undefined && (typeof h !== 'string' || !hex.test(h)))
      throw new Error('INVALID_CHECKPOINT')
  identifier(v.environmentId)
  if (!uuid.test(o.ledgerId)) throw new Error('INVALID_CHECKPOINT')
  head(v.head, o.ledgerId)
  if (v.pending !== undefined) {
    fields(v.pending, ['version', 'before', 'after'])
    head(v.pending.before, o.ledgerId)
    head(v.pending.after, o.ledgerId)
    if (
      v.pending.version !== 1 ||
      v.pending.before.sequence === Number.MAX_SAFE_INTEGER ||
      v.pending.after.sequence !== v.pending.before.sequence + 1 ||
      v.pending.before.digest === v.pending.after.digest ||
      ![stable(v.pending.before), stable(v.pending.after)].includes(stable(v.head))
    )
      throw new Error('INVALID_CHECKPOINT')
  }
  return { payload: v as unknown as Checkpoint, hash: result.hash }
}
export function createWitnessCheckpointGuard(
  o: CheckpointOptions,
  mode: { ownerInspection?: boolean } = {}
) {
  return async (current: WitnessHead, tx?: Transaction) => {
    if (!mode.ownerInspection)
      await assertRuntimeTrustFiles([
        o.publicKeyFile,
        o.checkpointFile,
        ...(o.historyFile ? [o.historyFile] : []),
        ...(o.configurationFile ? [o.configurationFile] : [])
      ])
    const { payload } = await readSignedCheckpoint(o)
    if (
      payload.pending ||
      current.ledgerId !== o.ledgerId ||
      current.sequence < payload.head.sequence ||
      (current.sequence === payload.head.sequence && current.digest !== payload.head.digest)
    )
      throw new Error('CHECKPOINT_MISMATCH')
    if (o.historyFile || payload.historyHash || current.sequence > payload.head.sequence) {
      if (!tx || !o.historyFile || !payload.historyHash)
        throw new Error('CHECKPOINT_HISTORY_REQUIRED')
      const bytes = await bounded(o.historyFile, 4000000)
      if (createHash('sha256').update(bytes).digest('hex') !== payload.historyHash)
        throw new Error('CHECKPOINT_HISTORY_MISMATCH')
      await verifyCheckpointHistory(tx, JSON.parse(bytes.toString()), o.namespace, o.ledgerId)
    }
  }
}
export interface RecoveryBinding {
  environmentId: string
  recoveryId: string
  checkpointHash: string
  configurationVersion: string
  bundleHash: string
  targetDirectory: string
}
export async function consumeRecoveryAuthorization(o: {
  authorizationFile: string
  publicKeyFile: string
  usedDirectory: string
  expected: RecoveryBinding
  // Required for the local fourth-batch protected flow; omitted only by legacy callers.
  consumptionGuard?: RecoveryConsumptionGuard
  now?: () => Date
}) {
  const signedDocument = await signed(o.authorizationFile, o.publicKeyFile),
    p = signedDocument.payload
  fields(p, [
    'version',
    'kind',
    'environmentId',
    'recoveryId',
    'checkpointHash',
    'configurationVersion',
    'bundleHash',
    'targetDirectory',
    'nonce',
    'issuedAt',
    'expiresAt'
  ])
  if (p.version !== 1 || p.kind !== 'recovery-authorization')
    throw new Error('INVALID_RECOVERY_AUTHORIZATION')
  for (const key of [
    'environmentId',
    'recoveryId',
    'checkpointHash',
    'configurationVersion',
    'bundleHash',
    'targetDirectory'
  ] as const)
    if (typeof o.expected[key] !== 'string' || p[key] !== o.expected[key])
      throw new Error('RECOVERY_AUTHORIZATION_MISMATCH')
  identifier(p.environmentId)
  identifier(p.configurationVersion)
  if (
    typeof p.recoveryId !== 'string' ||
    !uuid.test(p.recoveryId) ||
    typeof p.nonce !== 'string' ||
    !uuid.test(p.nonce) ||
    typeof p.checkpointHash !== 'string' ||
    !hex.test(p.checkpointHash) ||
    typeof p.bundleHash !== 'string' ||
    !hex.test(p.bundleHash) ||
    typeof p.targetDirectory !== 'string' ||
    resolve(p.targetDirectory) !== p.targetDirectory
  )
    throw new Error('INVALID_RECOVERY_AUTHORIZATION')
  const now = (o.now ?? (() => new Date()))().getTime(),
    issued = typeof p.issuedAt === 'string' ? Date.parse(p.issuedAt) : NaN,
    expires = typeof p.expiresAt === 'string' ? Date.parse(p.expiresAt) : NaN
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now ||
    expires <= now ||
    expires <= issued ||
    expires - issued > 300000
  )
    throw new Error('RECOVERY_AUTHORIZATION_EXPIRED')
  const root = await lstat(o.usedDirectory)
  if (
    resolve(o.usedDirectory) !== o.usedDirectory ||
    (await realpath(o.usedDirectory)) !== o.usedDirectory ||
    !root.isDirectory() ||
    root.uid !== process.getuid?.() ||
    root.mode & 0o077
  )
    throw new Error('UNSAFE_AUTHORIZATION_RECEIPTS')
  const consumptionReceipt = {
    nonce: p.nonce,
    recoveryId: p.recoveryId,
    checkpointHash: p.checkpointHash,
    configurationVersion: p.configurationVersion as string,
    authorizationHash: signedDocument.hash,
    consumedAt: new Date(now).toISOString()
  }
  // Reserve externally first. Lost acknowledgements and local write failures
  // burn the grant; no restore may proceed until both durable writes succeed.
  await o.consumptionGuard?.consume(consumptionReceipt)
  const target = join(o.usedDirectory, p.nonce)
  let receipt
  try {
    receipt = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    )
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('RECOVERY_AUTHORIZATION_CONSUMED', { cause: e })
    throw e
  }
  try {
    await receipt.writeFile(
      JSON.stringify({
        version: 1,
        status: 'consumed',
        ...consumptionReceipt
      })
    )
    await receipt.sync()
  } finally {
    await receipt.close()
  }
  await syncBackupDirectory(o.usedDirectory)
  return {
    recoveryId: p.recoveryId,
    configurationVersion: p.configurationVersion,
    checkpointHash: p.checkpointHash
  }
}

export function readCheckpointConfig(
  file: string | undefined,
  ledgerId: string,
  namespace: 'wallet' | 'private-files'
): CheckpointOptions | undefined {
  if (!file) return undefined
  if (resolve(file) !== file || realpathSync(file) !== file)
    throw new Error('INVALID_CHECKPOINT_CONFIGURATION')
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.mode & 0o022 || stat.size > 16384)
    throw new Error('INVALID_CHECKPOINT_CONFIGURATION')
  const v: unknown = JSON.parse(readFileSync(file, 'utf8'))
  fields(v, [
    'environmentId',
    'checkpointFile',
    'publicKeyFile',
    'historyFile',
    'pairedPrivateConfigurationFile'
  ])
  identifier(v.environmentId)
  for (const p of [
    v.checkpointFile,
    v.publicKeyFile,
    ...(v.historyFile ? [v.historyFile] : []),
    ...(v.pairedPrivateConfigurationFile ? [v.pairedPrivateConfigurationFile] : [])
  ])
    if (typeof p !== 'string' || resolve(p) !== p)
      throw new Error('INVALID_CHECKPOINT_CONFIGURATION')
  return {
    configurationFile: file,
    ...(v.pairedPrivateConfigurationFile
      ? { pairedPrivateConfigurationFile: v.pairedPrivateConfigurationFile as string }
      : {}),
    environmentId: v.environmentId,
    checkpointFile: v.checkpointFile as string,
    publicKeyFile: v.publicKeyFile as string,
    ledgerId,
    namespace,
    ...(v.historyFile ? { historyFile: v.historyFile as string } : {})
  }
}
