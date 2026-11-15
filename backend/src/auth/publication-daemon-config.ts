import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CheckpointOptions } from './recovery-authority.js'

export interface PublicationDaemonConfig {
  environmentId: string
  configurationVersion: string
  custodyDirectory: string
  publicKeyFile: string
  privateKeyFile: string
  /** Raw 32-byte AES-256 key in an owner-only file. */
  encryptionKeyFile: string
  ledgerSources: Array<{
    namespace: 'wallet' | 'private-files'
    ledgerId: string
    urlFile: string
  }>
  wakeSocket?: string
  wakeSocketMode?: 384 | 432
  authorizationJournal?: {
    directory: string
    usedDirectory: string
    recoveryId: string
    checkpointHash: string
  }
  baselineCheckpoints?: CheckpointOptions[]
}
const fail = (): never => {
  throw new Error('PUBLICATION_DAEMON_CONFIG')
}
const path = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 1 && !v.includes('\0') && resolve(v) === v
const identifier = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(v)
const uuid = (v: unknown) =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
function fields(v: unknown, allowed: string[]): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    fail()
}
/** Bounded, no-follow, same-owner, single-link 0600 input. No key or URL is
 * accepted from runtime environment variables or reported in an exception. */
export async function readPublicationOwnerFile(file: string, limit = 65536): Promise<Buffer> {
  try {
    if (!path(file) || (await realpath(file)) !== file) return fail()
    const f = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const s = await f.stat()
      if (
        !s.isFile() ||
        s.uid !== process.getuid?.() ||
        s.nlink !== 1 ||
        (s.mode & 0o7777) !== 0o600 ||
        s.size > limit
      )
        return fail()
      const bytes = Buffer.alloc(limit + 1)
      let length = 0
      while (length < bytes.length) {
        const r = await f.read(bytes, length, bytes.length - length, null)
        if (!r.bytesRead) break
        length += r.bytesRead
      }
      if (length > limit) return fail()
      return bytes.subarray(0, length)
    } finally {
      await f.close()
    }
  } catch {
    return fail()
  }
}
export async function readPublicationDaemonConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<PublicationDaemonConfig> {
  try {
    const v: unknown = JSON.parse(
      (await readPublicationOwnerFile(env.WEB3_PUBLICATION_CUSTODY_CONFIG_FILE ?? '')).toString(
        'utf8'
      )
    )
    fields(v, [
      'environmentId',
      'configurationVersion',
      'custodyDirectory',
      'publicKeyFile',
      'privateKeyFile',
      'encryptionKeyFile',
      'ledgerSources',
      'wakeSocket',
      'wakeSocketMode',
      'baselineCheckpoints',
      'authorizationJournal'
    ])
    if (
      !identifier(v.environmentId) ||
      !identifier(v.configurationVersion) ||
      !['custodyDirectory', 'publicKeyFile', 'privateKeyFile', 'encryptionKeyFile'].every((k) =>
        path(v[k])
      ) ||
      !Array.isArray(v.ledgerSources) ||
      !v.ledgerSources.length ||
      v.ledgerSources.length > 64 ||
      (v.wakeSocket !== undefined &&
        (!path(v.wakeSocket) || Buffer.byteLength(v.wakeSocket) > 100)) ||
      (v.wakeSocketMode !== undefined &&
        (!v.wakeSocket || ![0o600, 0o660].includes(v.wakeSocketMode as number)))
    )
      return fail()
    const streams = new Set<string>()
    for (const s of v.ledgerSources) {
      fields(s, ['namespace', 'ledgerId', 'urlFile'])
      const key = s.namespace + ':' + s.ledgerId
      if (
        !['wallet', 'private-files'].includes(s.namespace as string) ||
        !uuid(s.ledgerId) ||
        !path(s.urlFile) ||
        streams.has(key)
      )
        return fail()
      streams.add(key)
    }
    if (v.authorizationJournal !== undefined) {
      fields(v.authorizationJournal, ['directory', 'usedDirectory', 'recoveryId', 'checkpointHash'])
      const j = v.authorizationJournal
      if (
        !path(j.directory) ||
        !path(j.usedDirectory) ||
        !uuid(j.recoveryId) ||
        typeof j.checkpointHash !== 'string' ||
        !/^[0-9a-f]{64}$/.test(j.checkpointHash)
      )
        return fail()
    }
    if (v.baselineCheckpoints !== undefined) {
      if (!Array.isArray(v.baselineCheckpoints) || v.baselineCheckpoints.length > 64) return fail()
      const seen = new Set<string>()
      for (const b of v.baselineCheckpoints) {
        fields(b, [
          'checkpointFile',
          'publicKeyFile',
          'environmentId',
          'namespace',
          'ledgerId',
          'historyFile',
          'configurationFile',
          'pairedPrivateConfigurationFile'
        ])
        const key = b.namespace + ':' + b.ledgerId
        if (
          !streams.has(key) ||
          seen.has(key) ||
          b.environmentId !== v.environmentId ||
          !path(b.checkpointFile) ||
          !path(b.publicKeyFile) ||
          ['historyFile', 'configurationFile', 'pairedPrivateConfigurationFile'].some(
            (k) => b[k] !== undefined && !path(b[k])
          )
        )
          return fail()
        seen.add(key)
      }
    }
    return v as unknown as PublicationDaemonConfig
  } catch {
    return fail()
  }
}
