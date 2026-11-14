import type { PrivateLifecycleLedger } from '../delivery-files/deletion-ledger.js'
import { assertOrderFilesMutable } from '../delivery-files/retention.service.js'
import { randomUUID } from 'node:crypto'
import type { EvidenceRecord, PrismaClient, ReviewEvent } from '../generated/prisma/client.js'
import { DomainError } from '../common/domain-error.js'
import { idInput, objectInput, textInput } from '../common/input.js'
import { transact, type Transaction } from '../database/transaction.js'
import { checkedVersion, digest, json, type FileGuard } from '../delivery-files/authorization.js'
import { DownloadService } from '../delivery-files/download.service.js'
import { idempotencyKey } from '../orders/idempotency-key.js'
import { chainScope, lockChain } from '../web3/escrow-projector.js'
import type { Web3Config } from '../web3/web3-types.js'
import { requireReviewAuthorization } from './review-authorization.js'

const uuid = (value: unknown) => idInput(value).toLowerCase()
const visibility = 'order_participants' as const

function submission(body: unknown) {
  const input = objectInput(
    body,
    ['text', 'versionId', 'deliveryReferenceId', 'consent'],
    ['consent']
  )
  if (input.consent !== true) throw new DomainError('INVALID_INPUT')
  const text = input.text === undefined ? '' : textInput(input.text, 10000)
  const versionId = input.versionId === undefined ? null : uuid(input.versionId)
  const deliveryReferenceId =
    input.deliveryReferenceId === undefined ? null : uuid(input.deliveryReferenceId)
  if (!text && !versionId && !deliveryReferenceId) throw new DomainError('INVALID_INPUT')
  return { text, versionId, deliveryReferenceId }
}

function evidenceResult(row: EvidenceRecord) {
  return {
    id: row.id,
    orderId: row.orderId,
    submitterId: row.submitterId,
    parentId: row.parentId,
    text: row.text,
    versionId: row.versionId,
    deliveryReferenceId: row.deliveryReferenceId,
    createdAt: row.createdAt.toISOString(),
    purpose: 'evidence' as const,
    visibility,
    fundsAffected: false
  }
}

function reviewResult(row: ReviewEvent) {
  return {
    id: row.id,
    orderId: row.orderId,
    actorId: row.actorId,
    action: row.action,
    createdAt: row.createdAt.toISOString(),
    fundsAffected: false
  }
}

export class EvidenceService {
  constructor(
    readonly client: PrismaClient,
    readonly config: Web3Config,
    readonly downloads: DownloadService,
    readonly privateLedger?: PrivateLifecycleLedger
  ) {}

  private async context(tx: Transaction, orderId: string, actorId: string, guard?: FileGuard) {
    // Same lock order as the file/chain services. The guard locks and rechecks
    // the authenticated account/session without opening a nested transaction.
    await lockChain(tx, chainScope(this.config))
    await guard?.(tx)
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${actorId}::uuid FOR SHARE`
    const actor = await tx.account.findUnique({ where: { id: actorId } })
    if (actor?.status !== 'active' || !['participant', 'admin'].includes(actor.role))
      throw new DomainError('FORBIDDEN')
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${orderId}, 8))`
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order || order.settlementMode !== 'testnet_escrow') throw new DomainError('NOT_FOUND')
    const participant =
      actor.role === 'participant' && [order.sellerId, order.buyerId].includes(actorId)
    return { order, actor, participant }
  }

  private async reader(tx: Transaction, context: Awaited<ReturnType<EvidenceService['context']>>) {
    if (context.participant) return null
    return requireReviewAuthorization(tx, context.order.id, context.actor.id)
  }

  private async audit(
    tx: Transaction,
    orderId: string,
    actorId: string,
    action: string,
    details: object
  ) {
    await tx.fileAccessAudit.create({ data: { orderId, actorId, action, details: json(details) } })
  }

  // A one-chunk probe detects missing/deleted objects without hashing up to
  // 500 MB under a database lock. Read errors are private storage failures.
  private async probe(objectKey: string) {
    let body: Awaited<ReturnType<DownloadService['store']['read']>> | undefined
    try {
      body = await this.downloads.store.read(objectKey, AbortSignal.timeout(1000))
      const first = await body[Symbol.asyncIterator]().next()
      if (first.done) throw new Error('Empty private object')
    } catch {
      throw new DomainError('FILE_UNAVAILABLE')
    } finally {
      body?.destroy()
    }
  }

  async submitEvidence(
    orderId: string,
    actorId: string,
    body: unknown,
    key: string,
    guard?: FileGuard
  ) {
    return this.publish(
      uuid(orderId),
      uuid(actorId),
      null,
      submission(body),
      idempotencyKey(key),
      guard
    )
  }

  async appendEvidence(
    orderId: string,
    actorId: string,
    parentId: string,
    body: unknown,
    key: string,
    guard?: FileGuard
  ) {
    return this.publish(
      uuid(orderId),
      uuid(actorId),
      uuid(parentId),
      submission(body),
      idempotencyKey(key),
      guard
    )
  }

  private async publish(
    orderId: string,
    actorId: string,
    parentId: string | null,
    input: ReturnType<typeof submission>,
    key: string,
    guard?: FileGuard
  ) {
    return transact(this.client, async (tx) => {
      const context = await this.context(tx, orderId, actorId, guard)
      if (!context.participant) throw new DomainError('FORBIDDEN')
      const existing = await tx.evidenceRecord.findUnique({
        where: { submitterId_key: { submitterId: actorId, key } }
      })
      if (existing) {
        if (
          existing.orderId !== orderId ||
          existing.parentId !== parentId ||
          existing.text !== input.text ||
          existing.versionId !== input.versionId ||
          existing.deliveryReferenceId !== input.deliveryReferenceId
        )
          throw new DomainError('IDEMPOTENCY_CONFLICT')
        await this.privateLedger?.append('evidence', existing.id, {
          id: existing.id,
          orderId,
          versionId: existing.versionId,
          deliveryReferenceId: existing.deliveryReferenceId,
          bodyHash: digest({
            text: existing.text,
            versionId: existing.versionId,
            deliveryReferenceId: existing.deliveryReferenceId,
            parentId: existing.parentId
          })
        })
        return evidenceResult(existing)
      }
      if (parentId) {
        const parent = await tx.evidenceRecord.findUnique({ where: { id: parentId } })
        if (!parent || parent.orderId !== orderId) throw new DomainError('NOT_FOUND')
        if (parent.submitterId !== actorId) throw new DomainError('FORBIDDEN')
      }
      if (input.versionId) {
        const version = await checkedVersion(tx, orderId, input.versionId, actorId, 'evidence')
        await this.probe(version.objectKey)
      }
      if (input.deliveryReferenceId)
        await checkedVersion(
          tx,
          orderId,
          input.deliveryReferenceId,
          context.order.sellerId,
          'delivery'
        )
      await assertOrderFilesMutable(tx, orderId)
      const row = await tx.evidenceRecord.create({
        data: {
          id: randomUUID(),
          orderId,
          submitterId: actorId,
          key,
          parentId,
          ...input,
          createdAt: new Date()
        }
      })
      await this.privateLedger?.append('evidence', row.id, {
        id: row.id,
        orderId,
        versionId: row.versionId,
        deliveryReferenceId: row.deliveryReferenceId,
        bodyHash: digest({
          text: row.text,
          versionId: row.versionId,
          deliveryReferenceId: row.deliveryReferenceId,
          parentId: row.parentId
        })
      })
      await this.audit(tx, orderId, actorId, parentId ? 'evidence_append' : 'evidence_submit', {
        evidenceId: row.id,
        parentId,
        consent: true,
        visibility,
        purpose: 'evidence',
        fundsAffected: false
      })
      return evidenceResult(row)
    })
  }

  private async metadata(
    tx: Transaction,
    row: EvidenceRecord,
    versionId: string,
    purpose: 'evidence' | 'delivery',
    sellerId: string
  ) {
    try {
      const version = await checkedVersion(
        tx,
        row.orderId,
        versionId,
        purpose === 'evidence' ? row.submitterId : sellerId,
        purpose
      )
      // Never return an object locator, manifest salt, permit or signature.
      return {
        versionId,
        purpose,
        available: true,
        filename: version.filename,
        contentType: version.contentType,
        byteSize: version.byteSize,
        sha256: version.sha256
      }
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        !['STATE_CONFLICT', 'FILE_UNAVAILABLE'].includes(error.code)
      )
        throw error
      return { versionId, purpose, available: false }
    }
  }

  async readEvidence(orderId: string, actorId: string, guard?: FileGuard) {
    orderId = uuid(orderId)
    actorId = uuid(actorId)
    return transact(this.client, async (tx) => {
      const context = await this.context(tx, orderId, actorId, guard)
      const scope = await this.reader(tx, context)
      const rows = await tx.evidenceRecord.findMany({
        where: { orderId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      })
      const evidence = []
      for (const row of rows)
        evidence.push({
          ...evidenceResult(row),
          attachment: row.versionId
            ? await this.metadata(tx, row, row.versionId, 'evidence', context.order.sellerId)
            : null,
          deliveryReference: row.deliveryReferenceId
            ? await this.metadata(
                tx,
                row,
                row.deliveryReferenceId,
                'delivery',
                context.order.sellerId
              )
            : null
        })
      const latest = await tx.reviewEvent.findFirst({
        where: { orderId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })
      await this.audit(tx, orderId, actorId, 'evidence_read', {
        authorizationId: scope?.id ?? null,
        evidenceIds: rows.map((row) => row.id)
      })
      return {
        orderId,
        evidence,
        visibility,
        reviewState: latest?.action === 'close' ? 'closed' : 'open',
        fundsAffected: false
      }
    })
  }

  async authorizeEvidenceAttachment(
    orderId: string,
    evidenceId: string,
    actorId: string,
    guard?: FileGuard
  ) {
    orderId = uuid(orderId)
    evidenceId = uuid(evidenceId)
    actorId = uuid(actorId)
    return transact(this.client, async (tx) => {
      const context = await this.context(tx, orderId, actorId, guard)
      const scope = await this.reader(tx, context)
      const row = await tx.evidenceRecord.findUnique({ where: { id: evidenceId } })
      if (!row || row.orderId !== orderId) throw new DomainError('NOT_FOUND')
      // A delivery reference, including one visible to a reviewer, is never a
      // grantable evidence attachment. Require the published evidence version.
      if (!row.versionId) throw new DomainError('STATE_CONFLICT')
      const version = await checkedVersion(tx, orderId, row.versionId, row.submitterId, 'evidence')
      await this.probe(version.objectKey)
      const basis: Record<string, string> = { evidenceId, submitterId: row.submitterId }
      if (scope) {
        // Probe I/O can cross an authorization expiry; recheck before minting.
        const currentScope = await requireReviewAuthorization(tx, orderId, actorId)
        basis.authorizationId = currentScope.id
      }
      const grant = await this.downloads.grant(
        tx,
        orderId,
        version.id,
        actorId,
        'evidence',
        basis,
        async (finalTx) => {
          await guard?.(finalTx)
          if (scope) await requireReviewAuthorization(finalTx, orderId, actorId)
        }
      )
      await this.audit(tx, orderId, actorId, 'evidence_attachment_authorize', {
        evidenceId,
        versionId: version.id,
        grantId: grant.id,
        authorizationId: basis.authorizationId ?? null
      })
      return grant
    })
  }

  async closeReview(orderId: string, actorId: string, key: string, guard?: FileGuard) {
    return this.review(uuid(orderId), uuid(actorId), idempotencyKey(key), 'close', guard)
  }

  async reopenReview(orderId: string, actorId: string, key: string, guard?: FileGuard) {
    return this.review(uuid(orderId), uuid(actorId), idempotencyKey(key), 'reopen', guard)
  }

  private async review(
    orderId: string,
    actorId: string,
    key: string,
    action: 'close' | 'reopen',
    guard?: FileGuard
  ) {
    return transact(this.client, async (tx) => {
      await this.context(tx, orderId, actorId, guard)
      const scope = await requireReviewAuthorization(tx, orderId, actorId)
      const existing = await tx.reviewEvent.findUnique({ where: { actorId_key: { actorId, key } } })
      if (existing) {
        if (existing.orderId !== orderId || existing.action !== action)
          throw new DomainError('IDEMPOTENCY_CONFLICT')
        return reviewResult(existing)
      }
      const latest = await tx.reviewEvent.findFirst({
        where: { orderId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })
      await assertOrderFilesMutable(tx, orderId)
      const closed = latest?.action === 'close'
      if ((action === 'close') === closed) throw new DomainError('STATE_CONFLICT')
      // PostgreSQL now() is the transaction start, which may precede a lock
      // wait. Preserve event ordering even for transactions started earlier.
      const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1))
      const row = await tx.reviewEvent.create({
        data: {
          orderId,
          actorId,
          action,
          key,
          createdAt,
          details: { authorizationId: scope.id, fundsAffected: false }
        }
      })
      await this.privateLedger?.append('review', row.id, {
        ...row,
        createdAt: row.createdAt.toISOString()
      })
      await this.audit(tx, orderId, actorId, 'review_' + action, {
        reviewEventId: row.id,
        authorizationId: scope.id,
        fundsAffected: false
      })
      return reviewResult(row)
    })
  }
}
