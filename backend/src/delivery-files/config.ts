import { readFileSync, statSync } from 'node:fs'
import type { PrivateGarageConfig } from './object-store.js'
import { validateBudget, type PrivateFileBudget } from './quota.service.js'
import type { CheckerRuntime } from './check-worker.js'

export interface PrivateFileConfig {
  uploadOrigin: string
  store: PrivateGarageConfig
  uploadKey: Buffer
  budget: PrivateFileBudget
  checker: CheckerRuntime
  scratchRoot: string
}
function secret(file: unknown) {
  if (typeof file !== 'string' || !file.startsWith('/'))
    throw new Error('Private file credential path required')
  const info = statSync(file)
  if (!info.isFile() || info.mode & 0o077 || info.size > 1024)
    throw new Error('Unsafe private file credential file')
  const value = readFileSync(file, 'utf8').trim()
  if (!value || /[\r\n]/.test(value)) throw new Error('Invalid private file credential')
  return value
}
export function readPrivateFileConfig(
  env: NodeJS.ProcessEnv,
  appOrigin: string
): PrivateFileConfig | null {
  const path = env.PRIVATE_FILE_CONFIG_FILE
  if (!path) return null
  const configFile = statSync(path)
  if (!configFile.isFile() || configFile.mode & 0o022 || configFile.size > 8192)
    throw new Error('Unsafe private file config')
  const input = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const origin = new URL(String(input.uploadOrigin)),
    website = new URL(appOrigin),
    endpoint = new URL(String(input.endpoint))
  const local = (url: URL) =>
    env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    origin.origin !== input.uploadOrigin ||
    origin.hostname === website.hostname ||
    origin.username ||
    origin.password ||
    !(origin.protocol === 'https:' || (origin.protocol === 'http:' && local(origin)))
  )
    throw new Error('Upload origin must be independent and secure')
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash ||
    !(
      endpoint.protocol === 'https:' ||
      (endpoint.protocol === 'http:' && env.NODE_ENV !== 'production')
    )
  )
    throw new Error('Invalid private Garage endpoint')
  if (
    typeof input.bucket !== 'string' ||
    !/^[a-z][a-z0-9-]{2,62}$/.test(input.bucket) ||
    typeof input.scratchRoot !== 'string' ||
    !input.scratchRoot.startsWith('/')
  )
    throw new Error('Invalid private file storage configuration')
  const uploadKeyText = secret(input.uploadKeyFile)
  if (!/^[0-9a-fA-F]{64}$/.test(uploadKeyText)) throw new Error('Invalid private upload key')
  const uploadKey = Buffer.from(uploadKeyText, 'hex')
  if (uploadKey.length !== 32) throw new Error('Private upload key must contain 32 bytes in hex')
  const budget = validateBudget(input.budget as PrivateFileBudget),
    checker = input.checker as CheckerRuntime
  if (
    !checker ||
    checker.memoryBytes !== 4_000_000_000 ||
    checker.cpus !== 1 ||
    checker.pids !== 32 ||
    checker.tmpBytes !== 2_200_000_000 ||
    checker.wallSeconds !== 120 ||
    !/^(?:[a-z0-9./:_-]+@)?sha256:[0-9a-f]{64}$/.test(checker.image)
  )
    throw new Error('Pinned private checker and explicit local resource limits required')
  return {
    uploadOrigin: origin.origin,
    store: {
      endpoint: endpoint.origin,
      bucket: input.bucket,
      accessKeyId: secret(input.accessKeyIdFile),
      secretAccessKey: secret(input.secretAccessKeyFile)
    },
    uploadKey,
    budget,
    checker,
    scratchRoot: input.scratchRoot
  }
}
