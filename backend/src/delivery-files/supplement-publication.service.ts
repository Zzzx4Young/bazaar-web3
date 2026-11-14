import type { PrivateLifecycleLedger } from './deletion-ledger.js'
import { requireFileActor } from './authorization.js'
import type { FileGuard } from './authorization.js'
import { randomUUID, randomBytes } from 'node:crypto'
import { recoverTypedDataAddress, type Hex } from 'viem'
import type { PrismaClient, SupplementChallenge } from '../generated/prisma/client.js'
import { transact } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import type { Web3Config } from '../web3/web3-types.js'
import type { PrivateObjectStore } from './object-store.js'
import {
  bytes32,
  checkedVersion,
  commitment,
  deliveryContext,
  exactFirst,
  fileManifest,
  json,
  verifyObject,
  digest
} from './authorization.js'
export const supplementTypes = {
  SupplementPublication: [
    { name: 'purpose', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'escrow', type: 'address' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'deliveryVersion', type: 'bytes32' },
    { name: 'manifestCommitment', type: 'bytes32' },
    { name: 'seller', type: 'address' },
    { name: 'authorizationId', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' }
  ]
} as const
interface PublicationMessage {
  purpose: string
  chainId: number
  escrow: Hex
  orderId: Hex
  deliveryVersion: Hex
  manifestCommitment: Hex
  seller: Hex
  authorizationId: Hex
  issuedAt: number
  expiresAt: number
}
export function supplementTypedData(c: Web3Config, m: PublicationMessage) {
  return {
    domain: {
      name: 'Bazaar Supplement Publication',
      version: '1',
      chainId: c.chainId,
      verifyingContract: c.escrow
    },
    types: supplementTypes,
    primaryType: 'SupplementPublication' as const,
    message: {
      ...m,
      chainId: BigInt(m.chainId),
      issuedAt: BigInt(m.issuedAt),
      expiresAt: BigInt(m.expiresAt)
    }
  }
}
export function challengeView(c: Web3Config, row: SupplementChallenge) {
  return {
    id: row.id,
    expiresAt: row.expiresAt.toISOString(),
    typedData: supplementTypedData(c, row.message as unknown as PublicationMessage)
  }
}
export async function verifyPublicationSignature(
  config: Web3Config,
  row: SupplementChallenge,
  signature: Hex,
  seller: string,
  binding: {
    orderId: string
    actorId: string
    chainOrderId: string
    deliveryVersion: string
    manifestCommitment: string
  }
) {
  try {
    const m = row.message as unknown as PublicationMessage
    if (
      row.orderId !== binding.orderId ||
      row.actorId !== binding.actorId ||
      m.purpose !== 'supplement-publication-v1' ||
      m.chainId !== config.chainId ||
      m.escrow !== config.escrow ||
      m.orderId !== binding.chainOrderId ||
      m.seller !== seller ||
      m.deliveryVersion !== binding.deliveryVersion ||
      m.manifestCommitment !== binding.manifestCommitment ||
      m.authorizationId !== bytes32(row.id) ||
      !Number.isSafeInteger(m.issuedAt) ||
      !Number.isSafeInteger(m.expiresAt) ||
      m.expiresAt <= m.issuedAt ||
      m.expiresAt - m.issuedAt > 300 ||
      m.expiresAt * 1000 !== row.expiresAt.getTime()
    )
      throw new Error('publication binding')
    if (
      (
        await recoverTypedDataAddress({
          ...supplementTypedData(config, row.message as unknown as PublicationMessage),
          signature
        })
      ).toLowerCase() === seller
    )
      return
  } catch {
    /* untrusted signature */
  }
  throw new DomainError('FORBIDDEN')
}
export class SupplementPublicationService {
  constructor(
    private readonly client: PrismaClient,
    private readonly config: Web3Config,
    private readonly store: PrivateObjectStore,
    private readonly now: () => Date = () => new Date(),
    private readonly privateLedger?: PrivateLifecycleLedger
  ) {}
  async createChallenge(
    orderId: string,
    versionId: string,
    actorId: string,
    key: string,
    guard?: FileGuard
  ) {
    const version = await this.client.privateFileVersion.findFirst({
      where: { id: versionId, orderId, ownerId: actorId, purpose: 'delivery' }
    })
    if (!version) throw new DomainError('STATE_CONFLICT')
    await verifyObject(this.store, version)
    return transact(this.client, async (tx) => {
      const c = await deliveryContext(tx, this.config, orderId)
      await guard?.(tx)
      await requireFileActor(tx, actorId)
      if (c.order.sellerId !== actorId) throw new DomainError('FORBIDDEN')
      await exactFirst(tx, c)
      const previous = await tx.supplementChallenge.findUnique({
        where: { actorId_key: { actorId, key } }
      })
      if (previous) {
        const map = await tx.deliveryMapping.findUnique({ where: { id: previous.mappingId } })
        if (previous.orderId !== orderId || map?.versionId !== versionId)
          throw new DomainError('IDEMPOTENCY_CONFLICT')
        return challengeView(this.config, previous)
      }
      const v = await checkedVersion(tx, orderId, versionId, actorId, 'delivery'),
        id = randomUUID(),
        mappingId = randomUUID(),
        salt = randomBytes(32).toString('hex'),
        manifest = fileManifest(v),
        issuedAt = Math.floor(this.now().getTime() / 1000),
        expiresAt = issuedAt + 300
      const m: PublicationMessage = {
        purpose: 'supplement-publication-v1',
        chainId: this.config.chainId,
        escrow: this.config.escrow,
        orderId: c.terms.orderId,
        deliveryVersion: bytes32(v.id),
        manifestCommitment: commitment(manifest, salt) as Hex,
        seller: c.terms.seller,
        authorizationId: bytes32(id),
        issuedAt,
        expiresAt
      }
      await tx.deliveryMapping.create({
        data: {
          id: mappingId,
          actorId,
          orderId,
          key: 'supplement:' + key,
          versionId,
          chainId: this.config.chainId,
          escrow: this.config.escrow,
          chainOrderId: c.terms.orderId,
          credentialId: bytes32(mappingId),
          deliveryVersion: m.deliveryVersion,
          manifestCommitment: m.manifestCommitment,
          salt,
          manifest: json(manifest),
          permit: json({})
        }
      })
      const row = await tx.supplementChallenge.create({
        data: {
          id,
          orderId,
          actorId,
          key,
          mappingId,
          message: json(m),
          expiresAt: new Date(expiresAt * 1000)
        }
      })
      return challengeView(this.config, row)
    })
  }
  async publishSupplement(
    orderId: string,
    versionId: string,
    authorizationId: string,
    signature: Hex,
    actorId: string,
    guard?: FileGuard
  ) {
    const saved = await this.client.supplementPublication.findUnique({ where: { authorizationId } })
    if (!saved) {
      const v = await this.client.privateFileVersion.findFirst({
        where: { id: versionId, orderId, ownerId: actorId, purpose: 'delivery' }
      })
      if (!v) throw new DomainError('STATE_CONFLICT')
      await verifyObject(this.store, v)
    }
    return transact(this.client, async (tx) => {
      const c = await deliveryContext(tx, this.config, orderId)
      await guard?.(tx)
      await requireFileActor(tx, actorId)
      if (c.order.sellerId !== actorId) throw new DomainError('FORBIDDEN')
      const challenge = await tx.supplementChallenge.findUnique({ where: { id: authorizationId } })
      if (!challenge || challenge.orderId !== orderId || challenge.actorId !== actorId)
        throw new DomainError('FORBIDDEN')
      const mapping = await tx.deliveryMapping.findUnique({ where: { id: challenge.mappingId } })
      if (!mapping || mapping.versionId !== versionId) throw new DomainError('STATE_CONFLICT')
      await verifyPublicationSignature(this.config, challenge, signature, c.terms.seller, {
        orderId,
        actorId: c.order.sellerId,
        chainOrderId: c.terms.orderId,
        deliveryVersion: mapping.deliveryVersion,
        manifestCommitment: mapping.manifestCommitment
      })
      const result = { authorizationId, versionId }
      const old = await tx.supplementPublication.findUnique({ where: { authorizationId } })
      if (old) {
        if (old.signature !== signature) throw new DomainError('IDEMPOTENCY_CONFLICT')
        await this.privateLedger?.append('publication', authorizationId, {
          orderId,
          versionId,
          mappingId: mapping.id,
          signatureHash: digest(signature)
        })
        return result
      }
      await exactFirst(tx, c)
      if (this.now().getTime() >= challenge.expiresAt.getTime())
        throw new DomainError('STATE_CONFLICT')
      const v = await checkedVersion(tx, orderId, versionId, actorId, 'delivery')
      if (
        digest(fileManifest(v)) !== digest(mapping.manifest) ||
        commitment(mapping.manifest, mapping.salt) !== mapping.manifestCommitment
      )
        throw new DomainError('FILE_UNAVAILABLE')
      // Byte verification precedes the short transaction; immutable tuple and
      // ready status are rechecked under the same lock as final refund projection.
      await tx.supplementPublication.create({
        data: {
          authorizationId,
          orderId,
          mappingId: mapping.id,
          actorId,
          signature,
          evidence: json({
            message: challenge.message,
            manifest: mapping.manifest,
            objectDigest: v.sha256,
            height: c.cursor.height.toString(),
            blockHash: c.cursor.hash,
            state: c.state.state
          })
        }
      })
      await tx.fileAccessAudit.create({
        data: {
          orderId,
          actorId,
          action: 'supplement_publish',
          details: { authorizationId, versionId }
        }
      })
      await this.privateLedger?.append('publication', authorizationId, {
        orderId,
        versionId,
        mappingId: mapping.id,
        signatureHash: digest(signature)
      })
      return result
    })
  }
}
