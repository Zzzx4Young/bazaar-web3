import { rm } from 'node:fs/promises'
import { encryptedPartHash } from '../delivery-files/backup-crypto.js'
import { restoreRoleCustody, type CustodyKeys } from './recovery-custody.js'
import {
  consumeRecoveryAuthorization,
  readSignedCheckpoint,
  type CheckpointOptions
} from './recovery-authority.js'
export async function restoreAuthorizedCustody(o: {
  directory: string
  destination: string
  keys: CustodyKeys
  checkpoint: CheckpointOptions
  configurationVersion: string
  recoveryId: string
  authorizationFile: string
  publicKeyFile: string
  usedDirectory: string
}) {
  if (o.publicKeyFile !== o.checkpoint.publicKeyFile)
    throw new Error('PINNED_RECOVERY_AUTHORITY_REQUIRED')
  const c = await readSignedCheckpoint(o.checkpoint),
    bundleHash = await encryptedPartHash(o.directory, 'manifest')
  await consumeRecoveryAuthorization({
    authorizationFile: o.authorizationFile,
    publicKeyFile: o.publicKeyFile,
    usedDirectory: o.usedDirectory,
    expected: {
      environmentId: o.checkpoint.environmentId,
      recoveryId: o.recoveryId,
      checkpointHash: c.hash,
      configurationVersion: o.configurationVersion,
      bundleHash,
      targetDirectory: o.destination
    }
  })
  // Consumption precedes decryption. Failure requires a new owner grant, never
  // silently returns this authorization to an unused state.
  const files = await restoreRoleCustody({
    directory: o.directory,
    destination: o.destination,
    keys: o.keys,
    expectedBinding: {
      environmentId: o.checkpoint.environmentId,
      configurationVersion: o.configurationVersion
    }
  })
  if ((await encryptedPartHash(o.directory, 'manifest')) !== bundleHash) {
    for (const f of files) await rm(f.path)
    throw new Error('RECOVERY_BUNDLE_CHANGED')
  }
  return {
    files,
    recoveryId: o.recoveryId,
    configurationVersion: o.configurationVersion,
    checkpointHash: c.hash,
    checkpointSequence: c.payload.head.sequence,
    applicationOpened: false as const
  }
}
