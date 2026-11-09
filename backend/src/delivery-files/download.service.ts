import { assertFileRecovery, requireFileActor } from './authorization.js'
import type { FileGuard } from './authorization.js'
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import { transact, type Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import type { Web3Config } from '../web3/web3-types.js'
import type { PrivateObjectStore } from './object-store.js'
import {
  checkedVersion,
  commitment,
  deliveryContext,
  digest,
  exactFirst,
  fileManifest,
  resolveFirstMapping
} from './authorization.js'
import { verifyPublicationSignature } from './supplement-publication.service.js'
export class DownloadService {
  constructor(
    readonly client: PrismaClient,
    readonly config: Web3Config,
    readonly store: PrivateObjectStore,
    readonly origin: string,
    private readonly secret: Buffer,
    readonly now: () => Date = () => new Date()
  ) {
    if (secret.length < 32 || new URL(origin).origin !== origin)
      throw new Error('Invalid private download configuration')
  }
  private token(id: string, versionId: string, expiresAt: Date) {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify(['private-download-v1', id, versionId, expiresAt.toISOString()]))
      .digest('base64url')
  }
  async grant(
    tx: Transaction,
    orderId: string,
    versionId: string,
    actorId: string,
    purpose: 'delivery' | 'evidence',
    basis: Record<string, string>,
    afterProbe?: FileGuard
  ) {
    await assertFileRecovery(tx, this.config)
    const version = await tx.privateFileVersion.findUnique({ where: { id: versionId } })
    if (!version || version.orderId !== orderId || version.purpose !== purpose)
      throw new DomainError('FILE_UNAVAILABLE')
    let stream
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 2000)
    try {
      stream = await this.store.read(version.objectKey, controller.signal)
      if ((await stream[Symbol.asyncIterator]().next()).done)
        throw new Error('Empty private object')
    } catch {
      throw new DomainError('FILE_UNAVAILABLE')
    } finally {
      clearTimeout(timer)
      stream?.destroy()
    }
    await afterProbe?.(tx)
    await requireFileActor(tx, actorId)
    const id = randomUUID(),
      issuedAt = this.now(),
      expiresAt = new Date(issuedAt.getTime() + 300000),
      token = this.token(id, versionId, expiresAt)
    await tx.downloadGrant.create({
      data: {
        id,
        orderId,
        versionId,
        actorId,
        purpose,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        issuedAt,
        expiresAt,
        basis
      }
    })
    await tx.fileAccessAudit.create({
      data: {
        orderId,
        actorId,
        action: purpose + '_authorize',
        details: { grantId: id, versionId, expiresAt: expiresAt.toISOString() }
      }
    })
    return {
      id,
      token,
      issuedAt: issuedAt.getTime(),
      expiresAt: expiresAt.toISOString(),
      url: this.origin + '/downloads/' + id + '?token=' + token
    }
  }
  async readDelivery(orderId: string, accountId: string, guard?: FileGuard) {
    return transact(this.client, async (tx) => {
      const c = await deliveryContext(tx, this.config, orderId)
      await guard?.(tx)
      await requireFileActor(tx, accountId)
      if (![c.order.buyerId, c.order.sellerId].includes(accountId))
        throw new DomainError('FORBIDDEN')
      let firstVersionId: string | null = null,
        protectedMapping = false
      if (c.state.deliveredAt !== '0') {
        try {
          firstVersionId = (await resolveFirstMapping(tx, c)).version.id
        } catch (e) {
          if (!(e instanceof DomainError)) throw e
          protectedMapping = true
        }
      }
      const publications = await tx.supplementPublication.findMany({
        where: { orderId },
        orderBy: [{ createdAt: 'asc' }, { authorizationId: 'asc' }]
      })
      const publishedVersionIds: string[] = []
      for (const p of publications) {
        const m = await tx.deliveryMapping.findUnique({ where: { id: p.mappingId } }),
          ch = await tx.supplementChallenge.findUnique({ where: { id: p.authorizationId } })
        if (
          !m ||
          !ch ||
          ch.mappingId !== m.id ||
          m.orderId !== orderId ||
          m.chainOrderId !== c.terms.orderId ||
          digest((p.evidence as { message: unknown }).message) !== digest(ch.message)
        ) {
          protectedMapping = true
          continue
        }
        try {
          await verifyPublicationSignature(
            this.config,
            ch,
            p.signature as `0x${string}`,
            c.terms.seller,
            {
              orderId,
              actorId: c.order.sellerId,
              chainOrderId: c.terms.orderId,
              deliveryVersion: m.deliveryVersion,
              manifestCommitment: m.manifestCommitment
            }
          )
          const v = await checkedVersion(tx, orderId, m.versionId, c.order.sellerId, 'delivery')
          if (
            digest(fileManifest(v)) !== digest(m.manifest) ||
            commitment(m.manifest, m.salt) !== m.manifestCommitment
          )
            throw new DomainError('FILE_UNAVAILABLE')
          publishedVersionIds.push(v.id)
        } catch (e) {
          if (!(e instanceof DomainError)) throw e
          protectedMapping = true
        }
      }
      return {
        orderId,
        chainId: this.config.chainId,
        escrow: this.config.escrow,
        chainOrderId: c.terms.orderId,
        state: c.state.state,
        firstVersionId,
        publishedVersionIds: [...new Set(publishedVersionIds)],
        protectedMapping,
        downloadsAvailable: !!firstVersionId && !protectedMapping && c.state.state !== 'Refunded',
        deliveryDeadline: Number(c.state.fundedAt) + 259200,
        acceptanceDeadline:
          c.state.deliveredAt === '0' ? null : Number(c.state.deliveredAt) + 604800,
        disputeDeadline: c.state.disputedAt === '0' ? null : Number(c.state.disputedAt) + 604800,
        finalizedHeight: c.cursor.height.toString(),
        finalizedBlockHash: c.cursor.hash,
        linkLifetimeSeconds: 300,
        refundAddress: c.terms.refundAddress,
        sellerAddress: c.terms.seller
      }
    })
  }
  async authorizeDownload(
    orderId: string,
    versionId: string,
    accountId: string,
    guard?: FileGuard
  ) {
    return transact(this.client, async (tx) => {
      const c = await deliveryContext(tx, this.config, orderId)
      await guard?.(tx)
      await requireFileActor(tx, accountId)
      if (c.order.buyerId !== accountId) throw new DomainError('FORBIDDEN')
      const first = await exactFirst(tx, c)
      let mapping = first.mapping
      if (first.version.id !== versionId) {
        const maps = await tx.deliveryMapping.findMany({ where: { orderId, versionId } })
        let published = false
        for (const m of maps) {
          const p = await tx.supplementPublication.findFirst({
            where: { mappingId: m.id, orderId }
          })
          const challenge =
            p && (await tx.supplementChallenge.findUnique({ where: { id: p.authorizationId } }))
          if (!p || !challenge || challenge.mappingId !== m.id) continue
          await verifyPublicationSignature(
            this.config,
            challenge,
            p.signature as `0x${string}`,
            c.terms.seller,
            {
              orderId,
              actorId: c.order.sellerId,
              chainOrderId: c.terms.orderId,
              deliveryVersion: m.deliveryVersion,
              manifestCommitment: m.manifestCommitment
            }
          )
          const message = challenge.message as {
            manifestCommitment: string
            deliveryVersion: string
          }
          if (
            message.manifestCommitment !== m.manifestCommitment ||
            message.deliveryVersion !== m.deliveryVersion ||
            digest((p.evidence as { message: unknown }).message) !== digest(challenge.message)
          )
            throw new DomainError('FILE_UNAVAILABLE')
          mapping = m
          published = true
          break
        }
        if (!published) throw new DomainError('STATE_CONFLICT')
      }
      const v = await checkedVersion(tx, orderId, versionId, c.order.sellerId, 'delivery')
      if (
        digest(fileManifest(v)) !== digest(mapping.manifest) ||
        commitment(mapping.manifest, mapping.salt) !== mapping.manifestCommitment
      )
        throw new DomainError('FILE_UNAVAILABLE')
      return this.grant(
        tx,
        orderId,
        versionId,
        accountId,
        'delivery',
        {
          mappingId: mapping.id,
          height: c.cursor.height.toString(),
          blockHash: c.cursor.hash,
          firstCredentialId: first.mapping.credentialId
        },
        guard
      )
    })
  }
  // A previously minted capability has fixed expiry and intentionally survives
  // a later refund until then; no new grant, sliding expiry or ambient cookies.
  async readCapability(id: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError('FORBIDDEN')
    const row = await this.client.downloadGrant.findUnique({ where: { id } })
    const hash = createHash('sha256').update(token).digest()
    if (
      !row ||
      this.now().getTime() >= row.expiresAt.getTime() ||
      !timingSafeEqual(hash, Buffer.from(row.tokenHash, 'hex')) ||
      this.token(row.id, row.versionId, row.expiresAt) !== token
    )
      throw new DomainError('FORBIDDEN')
    const version = await this.client.privateFileVersion.findUnique({
      where: { id: row.versionId }
    })
    if (!version || version.orderId !== row.orderId || version.purpose !== row.purpose)
      throw new DomainError('FILE_UNAVAILABLE')
    const upload = await this.client.privateUpload.findUnique({ where: { id: version.uploadId } })
    if (upload?.status !== 'ready') throw new DomainError('FILE_UNAVAILABLE')
    const body = await this.store.read(version.objectKey, AbortSignal.timeout(30000))
    await this.client.fileAccessAudit.create({
      data: {
        orderId: row.orderId,
        actorId: row.actorId,
        action: 'capability_read',
        details: { grantId: id, versionId: version.id }
      }
    })
    return {
      body,
      filename: version.filename,
      contentType: version.contentType,
      byteSize: version.byteSize
    }
  }
}
