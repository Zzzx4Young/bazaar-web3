import { randomUUID } from 'node:crypto'
import type { PrismaClient, PrivateFileVersion } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { transact } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { chainScope, lockChain } from '../web3/escrow-projector.js'
import type { Web3Config } from '../web3/web3-types.js'
import { deliveryContext, recoveryRetentionContext, digest } from './authorization.js'
import type { PrivateObjectStore } from './object-store.js'
import { PrivateLifecycleLedger } from './deletion-ledger.js'
const day = 86400000
export async function assertOrderFilesMutable(tx: Transaction, orderId: string) {
  const versions = await tx.privateFileVersion.findMany({
    where: { orderId },
    select: { id: true }
  })
  if (
    await tx.privateFileDisposition.findFirst({
      where: { state: 'claimed', versionId: { in: versions.map((v) => v.id) } }
    })
  )
    throw new DomainError('STATE_CONFLICT')
}
export class RetentionService {
  constructor(
    readonly client: PrismaClient,
    readonly config: Web3Config,
    readonly store: PrivateObjectStore,
    readonly ledger: PrivateLifecycleLedger,
    readonly now: () => Date = () => new Date(),
    readonly recoveryRunId?: string
  ) {}
  private async lock(tx: Transaction) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('private-files:' || current_schema(),0))`
    await lockChain(tx, chainScope(this.config))
    const gate = await tx.privateRecoveryState.findUnique({ where: { singleton: true } })
    const global = await tx.privateFileGlobal.findUnique({ where: { singleton: true } })
    if (
      (gate &&
        gate.status !== 'active' &&
        !(this.recoveryRunId === gate.runId && ['isolated', 'verified'].includes(gate.status))) ||
      !global ||
      global.maintenance
    )
      throw new DomainError('FILE_UNAVAILABLE')
  }
  private async evaluate(tx: Transaction, v: PrivateFileVersion) {
    const refs = await tx.evidenceRecord.findMany({
      where: { OR: [{ versionId: v.id }, { deliveryReferenceId: v.id }] }
    })
    const orders = [...new Set([v.orderId, ...refs.map((r) => r.orderId)])]
    let until = 0
    for (const orderId of orders) {
      const c = this.recoveryRunId
        ? await recoveryRetentionContext(tx, this.config, orderId, this.recoveryRunId)
        : await deliveryContext(tx, this.config, orderId)
      if (!['Released', 'Refunded'].includes(c.state.state))
        return { eligible: false, reason: 'unfinished' }
      const terminal = await this.ledger.find('terminal', chainScope(this.config) + ':' + orderId)
      if (
        !terminal ||
        terminal.payload.chainOrderId !== c.terms.orderId ||
        terminal.payload.state !== c.state.state
      )
        return { eligible: false, reason: 'terminal_basis_missing' }
      const evidenceRefs = (await this.ledger.records('evidence')).filter(
        (r) => r.payload.orderId === orderId
      )
      for (const r of evidenceRefs) {
        const e = await tx.evidenceRecord.findUnique({ where: { id: r.key } })
        if (
          !e ||
          digest({
            text: e.text,
            versionId: e.versionId,
            deliveryReferenceId: e.deliveryReferenceId,
            parentId: e.parentId
          }) !== r.payload.bodyHash
        )
          return { eligible: false, reason: 'independent_reference_missing' }
      }
      for (const r of (await this.ledger.records('delivery')).filter(
        (r) => r.payload.orderId === orderId
      )) {
        const m = await tx.deliveryMapping.findUnique({ where: { id: r.key } })
        if (!m || m.versionId !== r.payload.versionId)
          return { eligible: false, reason: 'independent_delivery_missing' }
      }
      for (const r of (await this.ledger.records('publication')).filter(
        (r) => r.payload.orderId === orderId
      )) {
        if (!(await tx.supplementPublication.findUnique({ where: { authorizationId: r.key } })))
          return { eligible: false, reason: 'independent_publication_missing' }
      }
      const independentReview = (await this.ledger.records('review'))
        .filter((r) => r.payload.orderId === orderId)
        .at(-1)
      const start = Date.parse(String(terminal.payload.verifiedAt))
      if (!Number.isFinite(start)) throw new DomainError('FILE_UNAVAILABLE')
      until = Math.max(until, start + 90 * day)
      if (
        independentReview ||
        evidenceRefs.length > 0 ||
        v.purpose === 'evidence' ||
        refs.some((r) => r.orderId === orderId) ||
        c.state.disputedAt !== '0'
      ) {
        const independent = (await this.ledger.records('review'))
          .filter((r) => r.payload.orderId === orderId)
          .at(-1)
        const current = await tx.reviewEvent.findFirst({
          where: { orderId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        })
        if (
          !independent ||
          !current ||
          independent.key !== current.id ||
          current.action !== 'close' ||
          independent.payload.action !== 'close' ||
          independent.payload.createdAt !== current.createdAt.toISOString()
        )
          return { eligible: false, reason: 'review_unfinished_or_incomplete' }
        until = Math.max(until, Math.max(start, current.createdAt.getTime()) + 180 * day)
      }
    }
    return { eligible: this.now().getTime() >= until, deadline: new Date(until).toISOString() }
  }
  async eligibility(versionId: string) {
    return transact(this.client, async (tx) => {
      await this.lock(tx)
      const v = await tx.privateFileVersion.findUnique({ where: { id: versionId } })
      if (!v) throw new DomainError('NOT_FOUND')
      return this.evaluate(tx, v)
    })
  }
  async claimDeletion(versionId: string) {
    return transact(this.client, async (tx) => {
      await this.lock(tx)
      const v = await tx.privateFileVersion.findUnique({ where: { id: versionId } })
      if (!v) throw new DomainError('NOT_FOUND')
      const old = await this.ledger.find('claim', v.id),
        done = await this.ledger.find('deleted', v.id)
      if (done && old) return { id: String(old.payload.claimId), versionId: v.id, state: 'deleted' }
      const eligible = await this.evaluate(tx, v)
      if (!eligible.eligible || !eligible.deadline) throw new DomainError('STATE_CONFLICT')
      const row =
        old ??
        (await this.ledger.append('claim', v.id, {
          claimId: randomUUID(),
          versionId: v.id,
          orderId: v.orderId,
          ownerId: v.ownerId,
          objectKey: v.objectKey,
          objectVersion: v.objectVersion,
          sha256: v.sha256,
          byteSize: v.byteSize,
          deadline: eligible.deadline,
          claimedAt: this.now().toISOString(),
          leaseExpiresAt: new Date(this.now().getTime() + 600000).toISOString(),
          scope: chainScope(this.config)
        }))
      if (
        row.payload.objectKey !== v.objectKey ||
        row.payload.objectVersion !== v.objectVersion ||
        row.payload.sha256 !== v.sha256 ||
        row.payload.byteSize !== v.byteSize
      )
        throw new DomainError('FILE_UNAVAILABLE')
      await tx.privateFileDisposition.upsert({
        where: { versionId: v.id },
        create: {
          versionId: v.id,
          claimId: String(row.payload.claimId),
          state: 'claimed',
          deadline: new Date(String(row.payload.deadline))
        },
        update: {}
      })
      return { id: String(row.payload.claimId), versionId: v.id, state: 'claimed' }
    })
  }
  async confirmDeletion(claimId: string) {
    return transact(this.client, async (tx) => {
      await this.lock(tx)
      const fence = await tx.privateFileDisposition.findUnique({ where: { claimId } })
      if (!fence) throw new DomainError('NOT_FOUND')
      const v = await tx.privateFileVersion.findUniqueOrThrow({ where: { id: fence.versionId } }),
        claim = await this.ledger.find('claim', v.id)
      if (
        !claim ||
        claim.payload.claimId !== claimId ||
        claim.payload.objectKey !== v.objectKey ||
        claim.payload.sha256 !== v.sha256
      )
        throw new DomainError('FILE_UNAVAILABLE')
      if (fence.state === 'deleted') return { id: claimId, state: 'deleted' }
      const done = await this.ledger.find('deleted', v.id)
      if (!done) {
        const eligible = await this.evaluate(tx, v)
        if (!eligible.eligible) throw new DomainError('STATE_CONFLICT')
        if (!this.store.assertRetentionSafety)
          throw new Error('Storage deletion safety is not verified')
        await this.store.assertRetentionSafety()
        await this.store.deleteAndConfirm(v.objectKey)
        await this.ledger.append('deleted', v.id, {
          claimId,
          versionId: v.id,
          objectKey: v.objectKey,
          objectVersion: v.objectVersion,
          deletedAt: this.now().toISOString(),
          deadline: eligible.deadline
        })
      }
      await tx.privateFileQuota.update({
        where: { accountId: v.ownerId },
        data: { usedBytes: { decrement: v.byteSize } }
      })
      await tx.privateFileGlobal.update({
        where: { singleton: true },
        data: { usedBytes: { decrement: v.byteSize } }
      })
      await tx.privateUpload.update({
        where: { id: v.uploadId },
        data: { status: 'cleaned', cleanedAt: this.now() }
      })
      await tx.privateFileDisposition.update({
        where: { versionId: v.id },
        data: { state: 'deleted' }
      })
      await tx.privateFileAudit.create({
        data: {
          uploadId: v.uploadId,
          action: 'retention_deleted',
          details: { claimId, versionId: v.id }
        }
      })
      return { id: claimId, state: 'deleted' }
    })
  }
}
