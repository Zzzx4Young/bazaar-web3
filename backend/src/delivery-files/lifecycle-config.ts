import { readFileSync, lstatSync } from 'node:fs'
import { isAbsolute } from 'node:path'
export interface PrivateLifecycleConfig {
  url: string
  ledgerId: string
  witnessDirectory: string
}
export function protectedText(path: string) {
  if (!isAbsolute(path)) throw new Error('Absolute protected file required')
  const s = lstatSync(path)
  if (!s.isFile() || s.uid !== process.getuid?.() || s.mode & 0o077)
    throw new Error('Unsafe protected file')
  return readFileSync(path, 'utf8').trim()
}
export function readPrivateLifecycleConfig(env: NodeJS.ProcessEnv): PrivateLifecycleConfig | null {
  if (!env.PRIVATE_LIFECYCLE_CONFIG_FILE) return null
  const v = JSON.parse(protectedText(env.PRIVATE_LIFECYCLE_CONFIG_FILE)) as {
    urlFile: string
    ledgerId: string
    witnessDirectory: string
  }
  if (
    Object.keys(v).some((k) => !['urlFile', 'ledgerId', 'witnessDirectory'].includes(k)) ||
    !v.urlFile ||
    !v.ledgerId ||
    !v.witnessDirectory ||
    !isAbsolute(v.witnessDirectory) ||
    !/^[0-9a-f-]{36}$/.test(v.ledgerId)
  )
    throw new Error('Invalid private ledger configuration')
  const url = new URL(protectedText(v.urlFile))
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname === '/')
    throw new Error('Invalid private ledger URL')
  return { url: url.toString(), ledgerId: v.ledgerId, witnessDirectory: v.witnessDirectory }
}
