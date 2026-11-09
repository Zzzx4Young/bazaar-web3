import { recoverTypedDataAddress } from 'viem'
import { deliveryTypedData } from './delivery-signing.js'
import type { DeliveryPermit } from '../web3/web3-types.js'
import { createHash } from 'node:crypto'
import type { PrivateFileVersion, Prisma } from '../generated/prisma/client.js'
import type { Authenticated, AuthService } from '../auth/auth.service.js'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { chainScope, deploymentDigest, lockChain } from '../web3/escrow-projector.js'
import { stable } from '../web3/chain-observer.js'
import type { Web3Config, OrderTerms } from '../web3/web3-types.js'
import type { ObservedOrder } from '../web3/escrow-state.js'
import type { PrivateObjectStore } from './object-store.js'
export const json = (v: unknown) => JSON.parse(stable(v)) as Prisma.InputJsonValue
export const digest = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex')
export const bytes32 = (id: string) =>
  ('0x' + id.replaceAll('-', '').padStart(64, '0')) as `0x${string}`
export function fileManifest(v: PrivateFileVersion) {
  return {
    schemaVersion: 1,
    orderId: v.orderId,
    versionId: v.id,
    objectKey: v.objectKey,
    objectVersion: v.objectVersion,
    sha256: v.sha256,
    byteSize: v.byteSize,
    contentType: v.contentType,
    filename: v.filename,
    checkId: v.checkId
  }
}
export const commitment = (manifest: unknown, salt: string) =>
  '0x' + digest({ purpose: 'bazaar-private-delivery-v1', salt, manifest })
export async function checkedVersion(
  tx: Transaction,
  orderId: string,
  versionId: string,
  owner: string,
  purpose: string
) {
  const v = await tx.privateFileVersion.findUnique({ where: { id: versionId } })
  if (!v || v.orderId !== orderId || v.ownerId !== owner || v.purpose !== purpose)
    throw new DomainError('STATE_CONFLICT')
  const u = await tx.privateUpload.findUnique({ where: { id: v.uploadId } })
  const check = await tx.privateFileCheck.findUnique({ where: { id: v.checkId } })
  if (
    !u ||
    u.status !== 'ready' ||
    !check ||
    (check.report as { status?: string }).status !== 'clean'
  )
    throw new DomainError('FILE_UNAVAILABLE')
  return v
}
// Fully read and hash the immutable bytes before issuing a delivery authorization.
// Streaming is bounded by the already checked size; no whole-file buffering.
export async function verifyObject(store: PrivateObjectStore, v: PrivateFileVersion) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 30000)
  try {
    const body = await store.read(v.objectKey, controller.signal),
      hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of body) {
      bytes += chunk.length
      if (bytes > v.byteSize) {
        body.destroy()
        throw new Error('size')
      }
      hash.update(chunk)
    }
    if (bytes !== v.byteSize || hash.digest('hex') !== v.sha256) throw new Error('digest')
  } catch {
    throw new DomainError('FILE_UNAVAILABLE')
  } finally {
    clearTimeout(timer)
  }
}
export async function deliveryContext(tx: Transaction, config: Web3Config, orderId: string) {
  await lockChain(tx, chainScope(config))
  const order = await tx.order.findUnique({ where: { id: orderId } })
  if (!order || order.settlementMode !== 'testnet_escrow') throw new DomainError('NOT_FOUND')
  const cursor = await tx.scanCheckpoint.findUnique({ where: { scope: chainScope(config) } })
  const terms = await tx.paymentOrderTerms.findUnique({ where: { orderId } })
  if (
    !cursor ||
    !config.chainDeployment ||
    cursor.status !== 'active' ||
    cursor.configHash !== deploymentDigest(config, config.chainDeployment) ||
    !terms
  )
    throw new DomainError('FILE_UNAVAILABLE')
  const t = terms.terms as unknown as OrderTerms
  if (t.chainId !== config.chainId || t.escrow !== config.escrow || t.token !== config.token)
    throw new DomainError('FILE_UNAVAILABLE')
  const projection = await tx.escrowProjection.findUnique({
    where: { scope_chainOrderId: { scope: chainScope(config), chainOrderId: t.orderId } }
  })
  if (
    !projection ||
    projection.businessOrderId !== orderId ||
    projection.holdReason ||
    projection.height !== cursor.height ||
    projection.blockHash !== cursor.hash
  )
    throw new DomainError('FILE_UNAVAILABLE')
  const state = projection.data as unknown as ObservedOrder
  if (
    state.state !== projection.state ||
    state.orderId !== t.orderId ||
    state.seller !== t.seller ||
    state.buyer !== t.buyer ||
    state.amountAtoms !== t.amountAtoms ||
    state.termsHash !== terms.termsHash
  )
    throw new DomainError('FILE_UNAVAILABLE')
  return { order, cursor, terms: t, state, projection }
}
export async function exactFirst(tx: Transaction, c: Awaited<ReturnType<typeof deliveryContext>>) {
  if (!['Delivered', 'Disputed', 'Released'].includes(c.state.state))
    throw new DomainError('STATE_CONFLICT')
  return resolveFirstMapping(tx, c)
}
export async function resolveFirstMapping(
  tx: Transaction,
  c: Awaited<ReturnType<typeof deliveryContext>>
) {
  const m = await tx.deliveryMapping.findUnique({ where: { credentialId: c.state.credentialId } })
  if (
    !m ||
    m.orderId !== c.order.id ||
    m.actorId !== c.order.sellerId ||
    m.chainOrderId !== c.terms.orderId ||
    m.chainId !== c.terms.chainId ||
    m.escrow !== c.terms.escrow ||
    m.deliveryVersion !== c.state.deliveryVersion ||
    m.manifestCommitment !== c.state.manifestCommitment
  )
    throw new DomainError('FILE_UNAVAILABLE')
  const s = await tx.deliverySignature.findUnique({ where: { mappingId: m.id } })
  if (!s) throw new DomainError('FILE_UNAVAILABLE')
  const permit = m.permit as unknown as DeliveryPermit
  try {
    if (
      permit.schemaVersion !== 1 ||
      permit.credentialId !== m.credentialId ||
      permit.orderId !== m.chainOrderId ||
      permit.seller !== c.terms.seller ||
      permit.deliveryVersion !== m.deliveryVersion ||
      permit.manifestCommitment !== m.manifestCommitment ||
      (
        await recoverTypedDataAddress({
          ...deliveryTypedData(permit, { chainId: m.chainId, escrow: m.escrow as `0x${string}` }),
          signature: s.signature as `0x${string}`
        })
      ).toLowerCase() !== s.signerAddress
    )
      throw new Error('mapping')
  } catch {
    throw new DomainError('FILE_UNAVAILABLE')
  }
  const v = await checkedVersion(tx, c.order.id, m.versionId, c.order.sellerId, 'delivery')
  if (
    digest(fileManifest(v)) !== digest(m.manifest) ||
    commitment(m.manifest, m.salt) !== m.manifestCommitment ||
    bytes32(v.id) !== m.deliveryVersion
  )
    throw new DomainError('FILE_UNAVAILABLE')
  return { mapping: m, version: v, signature: s.signature }
}

export type FileGuard = (tx: Transaction) => Promise<void>
export function fileSessionGuard(user: Authenticated, auth: AuthService): FileGuard {
  return async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${user.account.id}::uuid FOR UPDATE`
    await tx.$queryRaw`SELECT "tokenHash" FROM "Session" WHERE "tokenHash"=${user.tokenHash} FOR UPDATE`
    const current = await auth.authenticate('bazaar_session=' + user.token)
    if (current.account.id !== user.account.id) throw new DomainError('UNAUTHENTICATED')
  }
}

export async function requireFileActor(tx: Transaction, accountId: string) {
  const actor = await tx.account.findUnique({ where: { id: accountId } })
  if (!actor || actor.status !== 'active') throw new DomainError('FORBIDDEN')
}

// Evidence bytes have an independent refund policy, but never bypass recovery
// or finalized-contradiction isolation. RPC freshness is not an existing ACL.
export async function assertFileRecovery(tx: Transaction, config: Web3Config) {
  await lockChain(tx, chainScope(config))
  const cursor = await tx.scanCheckpoint.findUnique({ where: { scope: chainScope(config) } })
  if (
    !config.chainDeployment ||
    !cursor ||
    cursor.status !== 'active' ||
    cursor.height < cursor.deploymentBlock ||
    cursor.configHash !== deploymentDigest(config, config.chainDeployment)
  )
    throw new DomainError('FILE_UNAVAILABLE')
  const manifest = await tx.chainSnapshot.findUnique({
    where: { scope_height: { scope: chainScope(config), height: cursor.height } }
  })
  if (
    !manifest ||
    manifest.hash !== cursor.hash ||
    digest(manifest.globals) !== digest(cursor.globals)
  )
    throw new DomainError('FILE_UNAVAILABLE')
}
