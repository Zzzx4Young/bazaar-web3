import { createHash, createPublicKey, verify } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createConnection } from 'node:net'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { stable } from '../web3/chain-observer.js'
import { DomainError } from '../common/domain-error.js'
import { assertRuntimeTrustFiles } from './checkpoint-trust.js'
import type { PublicationOptions } from './publication-outbox.js'
export interface PublicationRuntimeConfig {
  environmentId: string
  configurationVersion: string
  configurationFile: string
  configurationHash: string
  wakeSocket: string
  openingFile: string
  publicKeyFile: string
  recoveryRunId: string
  walletLedgerId: string
  privateLedgerId?: string
}
export interface PublicationOpening {
  version: 1
  kind: 'publication-opening'
  environmentId: string
  configurationVersion: string
  recoveryRunId: string
  walletLedgerId: string
  privateLedgerId?: string
  checkpointHash: string
  offchainHistory: 'verified' | 'unknown'
}
export const publicationOpeningContext = 'bazaar-publication-opening-v1\n'
const identifier = /^[A-Za-z0-9._:-]{1,128}$/,
  uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/,
  sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
function publicBytes(path: string, limit = 16384) {
  if (typeof path !== 'string' || resolve(path) !== path || realpathSync(path) !== path)
    throw new Error('INVALID_PUBLICATION_RUNTIME_CONFIG')
  const s = lstatSync(path)
  if (!s.isFile() || s.nlink !== 1 || s.mode & 0o022 || s.size > limit)
    throw new Error('INVALID_PUBLICATION_RUNTIME_CONFIG')
  const bytes = readFileSync(path)
  if (bytes.length > limit) throw new Error('INVALID_PUBLICATION_RUNTIME_CONFIG')
  return bytes
}
export function readPublicationRuntimeConfig(
  env: NodeJS.ProcessEnv
): PublicationRuntimeConfig | undefined {
  const file = env.WEB3_PUBLICATION_RUNTIME_CONFIG_FILE
  if (!file) return undefined
  const bytes = publicBytes(file),
    v = JSON.parse(bytes.toString())
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (k) =>
        ![
          'environmentId',
          'configurationVersion',
          'wakeSocket',
          'openingFile',
          'publicKeyFile',
          'recoveryRunId',
          'walletLedgerId',
          'privateLedgerId'
        ].includes(k)
    ) ||
    typeof v.environmentId !== 'string' ||
    !identifier.test(v.environmentId) ||
    typeof v.configurationVersion !== 'string' ||
    !identifier.test(v.configurationVersion) ||
    typeof v.recoveryRunId !== 'string' ||
    !uuid.test(v.recoveryRunId) ||
    typeof v.walletLedgerId !== 'string' ||
    !uuid.test(v.walletLedgerId) ||
    (v.privateLedgerId !== undefined &&
      (typeof v.privateLedgerId !== 'string' || !uuid.test(v.privateLedgerId)))
  )
    throw new Error('INVALID_PUBLICATION_RUNTIME_CONFIG')
  for (const path of [v.wakeSocket, v.openingFile, v.publicKeyFile])
    if (typeof path !== 'string' || resolve(path) !== path)
      throw new Error('INVALID_PUBLICATION_RUNTIME_CONFIG')
  if (v.wakeSocket.length > 100) throw new Error('INVALID_PUBLICATION_RUNTIME_CONFIG')
  return { ...v, configurationFile: file, configurationHash: sha(bytes) }
}
/** Trusted custodian owns these public files outside runtime. The latest opening
 * declaration is not selected from a recovered business backup. Re-read for each
 * sensitive request; a verified C2 alone is not an offchain completeness proof. */
export async function readPublicationOpening(
  config: PublicationRuntimeConfig
): Promise<PublicationOpening> {
  try {
    await assertRuntimeTrustFiles([
      config.configurationFile,
      config.publicKeyFile,
      config.openingFile
    ])
    if (sha(publicBytes(config.configurationFile)) !== config.configurationHash)
      throw new Error('PUBLICATION_CONFIG_CHANGED')
    const doc = JSON.parse(publicBytes(config.openingFile).toString()),
      p = doc.payload as PublicationOpening
    if (
      !doc ||
      Object.keys(doc).sort().join(',') !== 'payload,signature' ||
      typeof doc.signature !== 'string' ||
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      Object.keys(p).some(
        (k) =>
          ![
            'version',
            'kind',
            'environmentId',
            'configurationVersion',
            'recoveryRunId',
            'walletLedgerId',
            'privateLedgerId',
            'checkpointHash',
            'offchainHistory'
          ].includes(k)
      )
    )
      throw new Error('INVALID_PUBLICATION_OPENING')
    const key = createPublicKey(publicBytes(config.publicKeyFile))
    if (
      key.asymmetricKeyType !== 'ed25519' ||
      !verify(
        null,
        Buffer.from(publicationOpeningContext + stable(p)),
        key,
        Buffer.from(doc.signature, 'base64')
      )
    )
      throw new Error('INVALID_PUBLICATION_OPENING')
    if (
      p.version !== 1 ||
      p.kind !== 'publication-opening' ||
      p.environmentId !== config.environmentId ||
      p.configurationVersion !== config.configurationVersion ||
      p.recoveryRunId !== config.recoveryRunId ||
      p.walletLedgerId !== config.walletLedgerId ||
      p.privateLedgerId !== config.privateLedgerId ||
      typeof p.checkpointHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(p.checkpointHash) ||
      !['verified', 'unknown'].includes(p.offchainHistory)
    )
      throw new Error('INVALID_PUBLICATION_OPENING')
    return p
  } catch {
    throw new DomainError('WALLET_UNAVAILABLE')
  }
}
export async function assertPublicationOpening(config: PublicationRuntimeConfig | undefined) {
  if (config && (await readPublicationOpening(config)).offchainHistory !== 'verified')
    throw new DomainError('WALLET_UNAVAILABLE')
}
/** Wake-only local IPC, never record/signature/credential transport. A failed wake
 * is safe: its committed outbox remains for startup and the 60-second sweep. */
export async function notifyPublication(socketPath: string): Promise<void> {
  return new Promise((resolveNotify, reject) => {
    const socket = createConnection(socketPath)
    socket.setTimeout(250)
    socket.once('connect', () => socket.end('wake\n'))
    socket.once('error', reject)
    socket.once('timeout', () => socket.destroy(new Error('PUBLICATION_WAKE_TIMEOUT')))
    socket.once('close', (hadError) => {
      if (!hadError) resolveNotify()
    })
  })
}
export function runtimePublicationOptions(
  config: PublicationRuntimeConfig | undefined,
  namespace: 'wallet' | 'private-files',
  ledgerId: string
): PublicationOptions | undefined {
  if (!config) return undefined
  if (ledgerId !== (namespace === 'wallet' ? config.walletLedgerId : config.privateLedgerId))
    throw new Error('PUBLICATION_LEDGER_IDENTITY_MISMATCH')
  return { environmentId: config.environmentId, notify: () => notifyPublication(config.wakeSocket) }
}
export class PublicationAccessGuard implements CanActivate {
  constructor(private readonly config: PublicationRuntimeConfig | undefined) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ url: string }>()
    if (request.url.split('?')[0] !== '/api/health/live')
      await assertPublicationOpening(this.config)
    return true
  }
}
