import type { PrivateLifecycleLedger } from './deletion-ledger.js'
import { digest } from './authorization.js'
import { requireFileActor } from './authorization.js'
import type { FileGuard } from './authorization.js'
import { randomUUID, randomBytes } from 'node:crypto'
import { hashTypedData, recoverTypedDataAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, statSync } from 'node:fs'
import type { PrismaClient } from '../generated/prisma/client.js'
import { transact } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import type { DeliveryPermit, Web3Config, Bytes32 } from '../web3/web3-types.js'
import type { DualChainObserver } from '../web3/chain-observer.js'
import type { PrivateObjectStore } from './object-store.js'
import {
  bytes32,
  checkedVersion,
  commitment,
  deliveryContext,
  fileManifest,
  json,
  verifyObject
} from './authorization.js'
export { deliveryTypedData } from './delivery-signing.js'
import { deliveryTypedData } from './delivery-signing.js'
export interface DeliverySigner {
  readonly keyId: Bytes32
  readonly address: string
  sign(p: DeliveryPermit): Promise<Hex>
}
export function readDeliverySigner(
  file: string | undefined,
  config: Web3Config
): DeliverySigner | null {
  if (!file) return null
  const stat = statSync(file)
  if (!stat.isFile() || stat.mode & 0o077 || stat.size > 1024)
    throw new Error('Unsafe delivery signer file')
  const v = JSON.parse(readFileSync(file, 'utf8')) as { key: Hex; keyId: Bytes32 }
  if (
    !/^0x[0-9a-f]{64}$/i.test(v.key) ||
    !/^0x[0-9a-f]{64}$/.test(v.keyId) ||
    /^0x0{64}$/.test(v.keyId)
  )
    throw new Error('Invalid delivery signer')
  if (config.paymentSignerFile) {
    const payment = JSON.parse(readFileSync(config.paymentSignerFile, 'utf8')) as { key?: string }
    if (payment.key?.toLowerCase() === v.key.toLowerCase())
      throw new Error('Delivery and payment signing keys must differ')
  }
  const account = privateKeyToAccount(v.key)
  return {
    keyId: v.keyId,
    address: account.address.toLowerCase(),
    sign: (p) => account.signTypedData(deliveryTypedData(p, config))
  }
}
export interface DeliverySignerVerifier {
  verifySigner(
    keyId: Bytes32,
    address: string,
    issuedAt: number,
    expiresAt: number
  ): Promise<boolean>
}
export class ChainDeliverySignerVerifier implements DeliverySignerVerifier {
  constructor(private readonly observer: DualChainObserver) {}
  async verifySigner(id: Bytes32, address: string, issuedAt: number, expiresAt: number) {
    const h = await this.observer.readVerifiedSnapshot()
    await this.observer.verifyDeployment(h)
    const key = await this.observer.call('signers', [1, id], h)
    return (
      Array.isArray(key) &&
      String(key[0]).toLowerCase() === address &&
      !key[3] &&
      BigInt(issuedAt) >= BigInt(key[1]) &&
      BigInt(expiresAt) <= BigInt(key[2])
    )
  }
}
export class DeliveryPermitService {
  constructor(
    private readonly client: PrismaClient,
    private readonly config: Web3Config,
    private readonly store: PrivateObjectStore,
    private readonly signer: DeliverySigner,
    private readonly verifier: DeliverySignerVerifier,
    private readonly now: () => Date = () => new Date(),
    private readonly privateLedger?: PrivateLifecycleLedger
  ) {}
  async issueDeliveryPermit(
    orderId: string,
    versionId: string,
    actorId: string,
    key: string,
    guard?: FileGuard
  ) {
    // Reserve the exact mapping first; a crash or lost signature response resumes it.
    const mapping = await transact(this.client, async (tx) => {
      const c = await deliveryContext(tx, this.config, orderId)
      await guard?.(tx)
      await requireFileActor(tx, actorId)
      if (c.order.sellerId !== actorId) throw new DomainError('FORBIDDEN')
      const existing = await tx.deliveryMapping.findUnique({
        where: { actorId_key: { actorId, key } }
      })
      if (existing) {
        if (existing.orderId !== orderId || existing.versionId !== versionId)
          throw new DomainError('IDEMPOTENCY_CONFLICT')
        return existing
      }
      if (c.state.state !== 'Funded' || Date.now() - c.cursor.updatedAt.getTime() > 30000)
        throw new DomainError('STATE_CONFLICT')
      const v = await checkedVersion(tx, orderId, versionId, actorId, 'delivery')
      const issuedAt = Math.floor(this.now().getTime() / 1000),
        expiresAt = Math.min(issuedAt + 300, Number(c.state.fundedAt) + 259200)
      if (issuedAt >= expiresAt) throw new DomainError('STATE_CONFLICT')
      const id = randomUUID(),
        salt = randomBytes(32).toString('hex'),
        manifest = fileManifest(v)
      const permit: DeliveryPermit = {
        schemaVersion: 1,
        credentialId: bytes32(id),
        orderId: c.terms.orderId,
        seller: c.terms.seller,
        deliveryVersion: bytes32(v.id),
        manifestCommitment: commitment(manifest, salt) as Bytes32,
        issuedAt,
        expiresAt,
        signerKeyId: this.signer.keyId
      }
      return tx.deliveryMapping.create({
        data: {
          id,
          orderId,
          actorId,
          key,
          versionId,
          chainId: this.config.chainId,
          escrow: this.config.escrow,
          chainOrderId: c.terms.orderId,
          credentialId: permit.credentialId,
          deliveryVersion: permit.deliveryVersion,
          manifestCommitment: permit.manifestCommitment,
          salt,
          manifest: json(manifest),
          permit: json(permit)
        }
      })
    })
    const p = mapping.permit as unknown as DeliveryPermit
    const saved = await this.client.deliverySignature.findUnique({
      where: { mappingId: mapping.id }
    })
    if (saved) {
      await this.privateLedger?.append('delivery', mapping.id, {
        mappingId: mapping.id,
        orderId,
        versionId,
        permitHash: digest(p),
        signatureHash: digest(saved.signature)
      })
      return { permit: p, signature: saved.signature }
    }
    const version = await this.client.privateFileVersion.findUniqueOrThrow({
      where: { id: versionId }
    })
    await verifyObject(this.store, version)
    if (
      !(await this.verifier.verifySigner(
        p.signerKeyId,
        this.signer.address,
        p.issuedAt,
        p.expiresAt
      ))
    )
      throw new DomainError('FILE_UNAVAILABLE')
    const signature = await this.signer.sign(p)
    if (
      (
        await recoverTypedDataAddress({ ...deliveryTypedData(p, this.config), signature })
      ).toLowerCase() !== this.signer.address
    )
      throw new DomainError('FILE_UNAVAILABLE')
    return transact(this.client, async (tx) => {
      const c = await deliveryContext(tx, this.config, orderId)
      await guard?.(tx)
      await requireFileActor(tx, actorId)
      if (
        c.order.sellerId !== actorId ||
        c.state.state !== 'Funded' ||
        Math.floor(this.now().getTime() / 1000) >= p.expiresAt
      )
        throw new DomainError('STATE_CONFLICT')
      await checkedVersion(tx, orderId, versionId, actorId, 'delivery')
      const s = await tx.deliverySignature.upsert({
        where: { mappingId: mapping.id },
        create: { mappingId: mapping.id, signature, signerAddress: this.signer.address },
        update: {}
      })
      await tx.fileAccessAudit.create({
        data: {
          orderId,
          actorId,
          action: 'delivery_permit',
          details: {
            mappingId: mapping.id,
            digest: hashTypedData(deliveryTypedData(p, this.config))
          }
        }
      })
      await this.privateLedger?.append('delivery', mapping.id, {
        mappingId: mapping.id,
        orderId,
        versionId,
        permitHash: digest(p),
        signatureHash: digest(s.signature)
      })
      return { permit: p, signature: s.signature }
    })
  }
}
