import { createPrivateKey, createPublicKey, sign, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, realpath, open, readFile, rm } from 'node:fs/promises'
import { join, resolve, relative, sep, isAbsolute } from 'node:path'
import type { LedgerWitness } from './ledger-witness.js'
import { captureCheckpointHistory } from './checkpoint-history.js'
import {
  recoveryDocumentContext,
  type Checkpoint,
  type CheckpointOptions
} from './recovery-authority.js'
import { protectedText } from '../delivery-files/lifecycle-config.js'
import { syncBackupDirectory } from '../delivery-files/backup-crypto.js'
import { stable } from '../web3/chain-observer.js'
import { randomUUID } from 'node:crypto'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
async function exclusive(path: string, body: string) {
  const f = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o644
  )
  try {
    await f.writeFile(body)
    await f.sync()
  } finally {
    await f.close()
  }
}
/** Privileged custodian path, never configured in the runtime. Signer is outside
 * both witness and public trust directories. It seals actual locked records. */
export async function publishWitnessCheckpoint(o: {
  witness: LedgerWitness
  environmentId: string
  publicDirectory: string
  publicKeyFile: string
  privateKeyFile: string
  label: string
  parentCheckpointHash?: string
}) {
  if (
    !/^[a-zA-Z0-9._:-]{1,128}$/.test(o.environmentId) ||
    !/^[a-z][a-zA-Z0-9-]{0,80}$/.test(o.label)
  )
    throw new Error('INVALID_CHECKPOINT_PUBLICATION')
  const dir = await lstat(o.publicDirectory)
  if (
    resolve(o.publicDirectory) !== o.publicDirectory ||
    (await realpath(o.publicDirectory)) !== o.publicDirectory ||
    !dir.isDirectory() ||
    dir.uid !== process.getuid?.() ||
    dir.mode & 0o022
  )
    throw new Error('UNSAFE_CHECKPOINT_PUBLICATION')
  const tail = relative(o.publicDirectory, o.privateKeyFile)
  if (!tail || (tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail)))
    throw new Error('PRIVATE_AUTHORITY_MUST_STAY_OUTSIDE_PUBLIC_STORE')
  const signer = createPrivateKey(protectedText(o.privateKeyFile)),
    pinned = createPublicKey(await readFile(o.publicKeyFile))
  if (
    signer.asymmetricKeyType !== 'ed25519' ||
    !createPublicKey(signer)
      .export({ type: 'spki', format: 'der' })
      .equals(pinned.export({ type: 'spki', format: 'der' }))
  )
    throw new Error('PINNED_AUTHORITY_MISMATCH')
  if (o.parentCheckpointHash && !/^[0-9a-f]{64}$/.test(o.parentCheckpointHash))
    throw new Error('INVALID_CHECKPOINT_PUBLICATION')
  const historyFile = join(o.publicDirectory, o.label + '.history'),
    checkpointFile = join(o.publicDirectory, o.label + '.json'),
    configurationFile = join(o.publicDirectory, o.label + '.config')
  return o.witness.withOwnerRecoverySnapshot(async (digest, tx) => {
    const f = await open(
      join(o.witness.directory, 'head.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    let h
    try {
      const s = await f.stat()
      if (!s.isFile() || s.size > 4096 || s.uid !== process.getuid?.() || s.mode & 0o077)
        throw new Error('UNSAFE_WITNESS_HEAD')
      h = JSON.parse(await f.readFile('utf8'))
    } finally {
      await f.close()
    }
    if (
      h.version !== 1 ||
      h.digest !== digest ||
      h.ledgerId !== o.witness.ledgerId ||
      !Number.isSafeInteger(h.sequence) ||
      h.sequence < 0
    )
      throw new Error('CHECKPOINT_MISMATCH')
    const history = JSON.stringify(
      await captureCheckpointHistory(tx, o.witness.namespace, o.witness.ledgerId)
    )
    if (Buffer.byteLength(history) > 4000000) throw new Error('CHECKPOINT_HISTORY_BUDGET')
    const payload: Checkpoint = {
      version: 1,
      kind: 'witness-checkpoint',
      checkpointId: randomUUID(),
      environmentId: o.environmentId,
      namespace: o.witness.namespace,
      ledgerId: o.witness.ledgerId,
      head: { version: h.version, ledgerId: h.ledgerId, sequence: h.sequence, digest: h.digest },
      historyHash: sha(history),
      ...(o.parentCheckpointHash ? { parentCheckpointHash: o.parentCheckpointHash } : {})
    }
    const document = {
      payload,
      signature: sign(
        null,
        Buffer.from(recoveryDocumentContext + stable(payload)),
        signer
      ).toString('base64')
    }
    let published = false
    try {
      await exclusive(historyFile, history)
      published = true
      await exclusive(checkpointFile, JSON.stringify(document))
      await exclusive(
        configurationFile,
        JSON.stringify({
          environmentId: o.environmentId,
          checkpointFile,
          historyFile,
          publicKeyFile: o.publicKeyFile
        })
      )
      await syncBackupDirectory(o.publicDirectory)
    } catch (e) {
      if (published) await rm(historyFile)
      throw e
    }
    const options: CheckpointOptions = {
      checkpointFile,
      historyFile,
      configurationFile,
      publicKeyFile: o.publicKeyFile,
      environmentId: o.environmentId,
      namespace: o.witness.namespace,
      ledgerId: o.witness.ledgerId
    }
    return { options, document }
  })
}
