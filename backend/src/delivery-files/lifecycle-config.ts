import {
  readPublicationRuntimeConfig,
  type PublicationRuntimeConfig
} from '../auth/publication-runtime.js'
import { readCheckpointConfig, type CheckpointOptions } from '../auth/recovery-authority.js'
import { readFileSync, lstatSync } from 'node:fs'
import { isAbsolute } from 'node:path'
export interface PrivateLifecycleConfig {
  url: string
  ledgerId: string
  witnessDirectory: string
  publication?: PublicationRuntimeConfig
  checkpoint?: CheckpointOptions
}
export function protectedText(path: string) {
  if (!isAbsolute(path)) throw new Error('Absolute protected file required')
  const s = lstatSync(path)
  if (!s.isFile() || s.uid !== process.getuid?.() || s.mode & 0o077)
    throw new Error('Unsafe protected file')
  return readFileSync(path, 'utf8').trim()
}
export function readPrivateLifecycleConfig(env: NodeJS.ProcessEnv): PrivateLifecycleConfig | null {
  if (!env.PRIVATE_LIFECYCLE_CONFIG_FILE) {
    if (env.WEB3_RECOVERY_PROFILE === 'controlled')
      throw new Error('CONTROLLED_CHECKPOINT_CONFIG_REQUIRED')
    return null
  }
  const v = JSON.parse(protectedText(env.PRIVATE_LIFECYCLE_CONFIG_FILE)) as {
    urlFile: string
    ledgerId: string
    witnessDirectory: string
    checkpointConfigFile?: string
  }
  if (
    Object.keys(v).some(
      (k) => !['urlFile', 'ledgerId', 'witnessDirectory', 'checkpointConfigFile'].includes(k)
    ) ||
    !v.urlFile ||
    !v.ledgerId ||
    !v.witnessDirectory ||
    !isAbsolute(v.witnessDirectory) ||
    !/^[0-9a-f-]{36}$/.test(v.ledgerId)
  )
    throw new Error('Invalid private ledger configuration')
  if (env.WEB3_RECOVERY_PROFILE === 'controlled' && !v.checkpointConfigFile)
    throw new Error('CONTROLLED_CHECKPOINT_CONFIG_REQUIRED')
  const url = new URL(protectedText(v.urlFile))
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname === '/')
    throw new Error('Invalid private ledger URL')
  return {
    publication: readPublicationRuntimeConfig(env),
    url: url.toString(),
    ledgerId: v.ledgerId,
    witnessDirectory: v.witnessDirectory,
    checkpoint: readCheckpointConfig(v.checkpointConfigFile, v.ledgerId, 'private-files')
  }
}
