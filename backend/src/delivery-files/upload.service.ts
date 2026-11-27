import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import type { PrismaClient, PrivateUpload, Prisma } from '../generated/prisma/client.js'
import { DomainError } from '../common/domain-error.js'
import { transact, type Transaction } from '../database/transaction.js'
import { objectInput, positiveInteger } from '../common/input.js'
import { requestHash } from '../orders/order-idempotency.js'
import { web3Policy } from '../web3/web3-policy.js'
import { PrivateFileQuotaService, type PrivateFileBudget } from './quota.service.js'
import { validZipCoverage } from './check-report.js'
import { processIdentity, processHasExited } from './process-identity.js'
import { byteGuard, type PrivateObjectStore, type ObjectReceipt } from './object-store.js'

export type PrivatePurpose = 'delivery' | 'evidence'
export interface FileCheckReport {
  status: 'clean' | 'rejected' | 'timeout'
  reason: string
  processStopped: boolean
  bytes?: number
  sha256?: string
  contentType?: string
  structural?: boolean
  malware?: { clean: boolean; engine: string; version: string; signatureDate: string;
    scope?: string; members?: { entries: number; expandedBytes: number; sha256: string } }
  elapsedMs?: number
  resource?: Record<string, string | number | boolean>
}
export interface PrivateFileChecker {
  check(
    path: string,
    contentType: string,
    jobId: string,
    options?: { wallMs: number; signal: AbortSignal }
  ): Promise<FileCheckReport>
  terminate(jobId: string): Promise<boolean>
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const json = (value: unknown) => value as Prisma.InputJsonValue
const types: Record<string, { extension: string[]; max: number }> = {
  'application/pdf': { extension: ['pdf'], max: web3Policy.fileBytes.pdf },
  'image/png': { extension: ['png'], max: web3Policy.fileBytes.png },
  'image/jpeg': { extension: ['jpg', 'jpeg'], max: web3Policy.fileBytes.jpeg },
  'application/zip': { extension: ['zip'], max: web3Policy.fileBytes.zip }
}
export class PrivateFileService {
  private readonly quota: PrivateFileQuotaService
  constructor(
    private readonly client: PrismaClient,
    private readonly store: PrivateObjectStore,
    budget: PrivateFileBudget,
    private readonly secret: Buffer,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!secret || secret.length < 32) throw new Error('Private upload key is required')
    this.quota = new PrivateFileQuotaService(budget)
  }
  private token(
    row: Pick<
      PrivateUpload,
      | 'id'
      | 'accountId'
      | 'orderId'
      | 'purpose'
      | 'filename'
      | 'contentType'
      | 'declaredBytes'
      | 'expiresAt'
    >
  ) {
    return createHmac('sha256', this.secret)
      .update(
        JSON.stringify([
          'private-upload-v1',
          row.id,
          row.accountId,
          row.orderId,
          row.purpose,
          row.filename,
          row.contentType,
          row.declaredBytes,
          row.expiresAt.toISOString()
        ])
      )
      .digest('base64url')
  }
  private async order(tx: Transaction, actorId: string, orderId: string, purpose: string) {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { snapshot: true } })
    if (
      !order ||
      order.settlementMode !== 'testnet_escrow' ||
      !order.snapshot ||
      order.snapshot.type !== 'digital'
    )
      throw new DomainError('NOT_FOUND')
    if (
      (purpose === 'delivery' && order.sellerId !== actorId) ||
      (purpose === 'evidence' && ![order.sellerId, order.buyerId].includes(actorId))
    )
      throw new DomainError('FORBIDDEN')
    if (purpose === 'delivery' && ['cancelled', 'refunded'].includes(order.status))
      throw new DomainError('STATE_CONFLICT')
    return order
  }
  private credential(row: PrivateUpload) {
    const token = this.token(row)
    if (hash(token) !== row.tokenHash) throw new DomainError('FILE_UNAVAILABLE')
    return {
      uploadId: row.id,
      uploadToken: token,
      uploadPath: `/uploads/${row.id}`,
      method: 'PUT',
      contentType: row.contentType,
      byteSize: row.declaredBytes,
      expiresAt: row.expiresAt.toISOString(),
      status: row.status
    }
  }
  async createUpload(actorId: string, orderId: string, body: unknown, key: string) {
    const input = objectInput(body, ['purpose', 'filename', 'contentType', 'byteSize'])
    if (
      !['delivery', 'evidence'].includes(String(input.purpose)) ||
      typeof input.filename !== 'string' ||
      typeof input.contentType !== 'string'
    )
      throw new DomainError('INVALID_INPUT')
    const filename = input.filename.normalize('NFKC')
    const type = types[input.contentType]
    if (
      filename.length < 1 ||
      filename.length > 160 ||
      /[\\/]/.test(filename) ||
      [...filename].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      !type ||
      !type.extension.includes(filename.split('.').at(-1)?.toLowerCase() ?? '')
    )
      throw new DomainError('INVALID_INPUT')
    const bytes = positiveInteger(input.byteSize, type.max),
      purpose = input.purpose as PrivatePurpose,
      now = this.now()
    const payload = { orderId, purpose, filename, contentType: input.contentType, bytes },
      digest = requestHash(payload)
    const row = await transact(this.client, async (tx) => {
      await this.quota.lock(tx, actorId)
      await this.order(tx, actorId, orderId, purpose)
      const prior = await tx.privateUpload.findUnique({
        where: { accountId_key: { accountId: actorId, key } }
      })
      if (prior) {
        if (prior.requestHash !== digest) throw new DomainError('IDEMPOTENCY_CONFLICT')
        return prior
      }
      await this.quota.reserve(tx, actorId, bytes, now)
      const id = randomUUID(),
        expiresAt = new Date(now.getTime() + web3Policy.uploadSeconds * 1000)
      const data = {
        id,
        accountId: actorId,
        orderId,
        purpose,
        key,
        requestHash: digest,
        filename,
        contentType: input.contentType as string,
        declaredBytes: bytes,
        objectKey: `objects/${id}/${randomUUID()}`,
        createdAt: now,
        expiresAt
      }
      return tx.privateUpload.create({ data: { ...data, tokenHash: hash(this.token(data)) } })
    })
    return this.credential(row)
  }
  private async upload(tx: Transaction, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "PrivateUpload" WHERE "id"=${id}::uuid FOR UPDATE`
    const row = await tx.privateUpload.findUnique({ where: { id } })
    if (!row) throw new DomainError('NOT_FOUND')
    return row
  }
  async receive(id: string, token: string, source: Readable, contentType: string) {
    const row = await transact(this.client, async (tx) => {
      await this.quota.lock(tx)
      const row = await this.upload(tx, id),
        actual = hash(token)
      if (
        actual.length !== row.tokenHash.length ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(row.tokenHash))
      )
        throw new DomainError('FORBIDDEN')
      await this.quota.lock(tx, row.accountId)
      if (
        row.expiresAt <= this.now() ||
        row.status !== 'uploading' ||
        row.contentType !== contentType
      )
        throw new DomainError('STATE_CONFLICT')
      const owner = processIdentity()
      await tx.privateUpload.update({
        where: { id },
        data: {
          status: 'receiving',
          receiveOwnerScope: owner.scope,
          receiveOwnerPid: owner.pid,
          receiveOwnerStart: owner.start,
          receiveStopped: false
        }
      })
      return row
    })
    const timer = setTimeout(() => source.destroy(new DomainError('FILE_UNAVAILABLE')), 900_000)
    let polling = false
    const watch = setInterval(() => {
      if (polling) return
      polling = true
      void this.client.privateUpload
        .findUnique({ where: { id } })
        .then((current) => {
          if (current?.status !== 'receiving' || current.expiresAt <= this.now())
            source.destroy(new DomainError('STATE_CONFLICT'))
        })
        .catch(() => source.destroy(new DomainError('FILE_UNAVAILABLE')))
        .finally(() => {
          polling = false
        })
    }, 200)
    try {
      const canContinue = async () => {
        const current = await this.client.privateUpload.findUnique({ where: { id } })
        if (current?.status !== 'receiving' || current.expiresAt <= this.now())
          throw new DomainError('STATE_CONFLICT')
      }
      await this.store.putOnce(
        row.objectKey,
        source,
        row.declaredBytes,
        row.contentType,
        async (receipt, finish) => {
          await transact(this.client, async (tx) => {
            await this.quota.lock(tx, row.accountId)
            const current = await this.upload(tx, id)
            if (current.status !== 'receiving' || current.expiresAt <= this.now())
              throw new DomainError('STATE_CONFLICT')
            await finish()
            await tx.privateUpload.update({
              where: { id },
              data: { status: 'quarantined', actualBytes: receipt.bytes, sha256: receipt.sha256 }
            })
            await this.audit(tx, id, 'received', { bytes: receipt.bytes, sha256: receipt.sha256 })
          })
        },
        canContinue
      )
      return { uploadId: id, status: 'quarantined' }
    } catch (e) {
      await this.client.privateUpload.updateMany({
        where: { id, status: 'receiving' },
        data: { status: 'cleanup_pending', failureReason: 'UPLOAD_FAILED' }
      })
      if (e instanceof DomainError) throw e
      throw new DomainError('FILE_UNAVAILABLE')
    } finally {
      clearTimeout(timer)
      clearInterval(watch)
      await this.client.privateUpload.updateMany({
        where: { id, receiveOwnerPid: process.pid },
        data: { receiveStopped: true }
      })
    }
  }
  async completeUpload(actorId: string, id: string) {
    await transact(this.client, async (tx) => {
      const global = await this.quota.lock(tx, actorId),
        row = await this.upload(tx, id)
      if (row.accountId !== actorId) throw new DomainError('FORBIDDEN')
      await this.order(tx, actorId, row.orderId, row.purpose)
      if (
        ['checking', 'ready'].includes(row.status) ||
        (row.status === 'quarantined' && row.queuedAt)
      )
        return
      if (row.status !== 'quarantined' || row.expiresAt <= this.now())
        throw new DomainError('STATE_CONFLICT')
      if (global.queued >= this.quota.budget.checkQueue) throw new DomainError('FILE_LIMIT_REACHED')
      await tx.privateUpload.update({ where: { id }, data: { queuedAt: this.now() } })
      await tx.privateFileGlobal.update({
        where: { singleton: true },
        data: { queued: { increment: 1 } }
      })
      await this.audit(tx, id, 'queued', {})
    })
    return this.status(actorId, id)
  }
  async status(actorId: string, id: string) {
    const row = await this.client.privateUpload.findUnique({ where: { id } })
    const actor = await this.client.account.findUnique({ where: { id: actorId } })
    if (actor?.status !== 'active' || actor.role !== 'participant')
      throw new DomainError('FORBIDDEN')
    if (!row || row.accountId !== actorId) throw new DomainError('NOT_FOUND')
    const version = await this.client.privateFileVersion.findUnique({ where: { uploadId: id } })
    return {
      uploadId: id,
      status: row.status,
      purpose: row.purpose,
      byteSize: row.actualBytes ?? row.declaredBytes,
      filename: row.filename,
      contentType: row.contentType,
      versionId: version?.id ?? null,
      failureReason: row.failureReason,
      downloadEnabled: false
    }
  }
  private async audit(tx: Transaction, id: string, action: string, details: object) {
    await tx.privateFileAudit.create({ data: { uploadId: id, action, details: json(details) } })
  }
  async cleanupUpload(id: string) {
    return transact(this.client, async (tx) => {
      await this.quota.lock(tx)
      const row = await this.upload(tx, id)
      if (row.status === 'cleaned') return
      // Completion is fenced by this same row lock; multipart uploads are aborted before release.
      if (
        !['cleanup_pending', 'rejected', 'check_timeout', 'expired'].includes(row.status) ||
        (await tx.privateFileVersion.count({ where: { uploadId: id } }))
      )
        throw new DomainError('STATE_CONFLICT')
      if (
        !row.receiveStopped &&
        !processHasExited({
          scope: row.receiveOwnerScope,
          pid: row.receiveOwnerPid,
          start: row.receiveOwnerStart
        })
      )
        throw new DomainError('STATE_CONFLICT')
      await this.store.deleteAndConfirm(row.objectKey)
      await tx.privateFileQuota.update({
        where: { accountId: row.accountId },
        data: { reservedBytes: { decrement: row.declaredBytes }, activeUploads: { decrement: 1 } }
      })
      await tx.privateFileGlobal.update({
        where: { singleton: true },
        data: { reservedBytes: { decrement: row.declaredBytes }, activeUploads: { decrement: 1 } }
      })
      await tx.privateUpload.update({
        where: { id },
        data: { status: 'cleaned', cleanedAt: this.now() }
      })
      await this.audit(tx, id, 'deleted', {
        reason: row.failureReason ?? row.status,
        bytes: row.declaredBytes
      })
    })
  }
  async expireUploads() {
    return transact(this.client, async (tx) => {
      await this.quota.lock(tx)
      const rows = await tx.privateUpload.findMany({
        where: {
          status: { in: ['uploading', 'receiving', 'quarantined'] },
          expiresAt: { lte: this.now() },
          queuedAt: null
        }
      })
      for (const row of rows) {
        await tx.privateUpload.update({
          where: { id: row.id },
          data: { status: 'expired', failureReason: 'UPLOAD_EXPIRED' }
        })
        await this.audit(tx, row.id, 'expired', {})
      }
      return rows.map((r) => r.id)
    })
  }
  async checkNext(checker: PrivateFileChecker, scratchRoot: string) {
    const row = await transact(this.client, async (tx) => {
      const global = await this.quota.lock(tx)
      if (global.checking >= this.quota.budget.checkConcurrency) return null
      const row = await tx.privateUpload.findFirst({
        where: { status: 'quarantined', queuedAt: { not: null } },
        orderBy: { queuedAt: 'asc' }
      })
      if (!row) return null
      if (row.queuedAt!.getTime() + 300_000 <= this.now().getTime()) {
        await tx.privateUpload.update({
          where: { id: row.id },
          data: { status: 'cleanup_pending', failureReason: 'QUEUE_TIMEOUT' }
        })
        await tx.privateFileGlobal.update({
          where: { singleton: true },
          data: { queued: { decrement: 1 } }
        })
        return null
      }
      const owner = processIdentity(),
        now = this.now()
      const next = await tx.privateUpload.update({
        where: { id: row.id },
        data: {
          status: 'checking',
          checkId: randomUUID(),
          checkStartedAt: now,
          checkOwnerScope: owner.scope,
          checkOwnerPid: owner.pid,
          checkOwnerStart: owner.start,
          checkOwnerStopped: false,
          checkCancelRequested: false,
          checkDeadlineAt: new Date(now.getTime() + (this.quota.budget.checkWallMs ?? 120000))
        }
      })
      await tx.privateFileGlobal.update({
        where: { singleton: true },
        data: { queued: { decrement: 1 }, checking: { increment: 1 } }
      })
      return next
    })
    if (!row || !row.checkId) return null
    const dir = resolve(scratchRoot, row.checkId),
      path = resolve(dir, 'object'),
      abort = new AbortController()
    const remaining = Math.max(1, row.checkDeadlineAt!.getTime() - this.now().getTime()),
      deadline = Date.now() + remaining
    const timer = setTimeout(() => abort.abort(), remaining)
    let polling = false
    let stopped: boolean
    const watch = setInterval(() => {
      if (polling) return
      polling = true
      void this.client.privateUpload
        .findUnique({ where: { id: row.id } })
        .then((current) => {
          if (
            current?.status !== 'checking' ||
            current.checkId !== row.checkId ||
            current.checkCancelRequested ||
            current.checkDeadlineAt! <= this.now()
          )
            abort.abort()
        })
        .catch(() => abort.abort())
        .finally(() => {
          polling = false
        })
    }, 100)
    const currentTask = async () => {
      const current = await this.client.privateUpload.findUnique({ where: { id: row.id } })
      if (
        abort.signal.aborted ||
        current?.status !== 'checking' ||
        current.checkId !== row.checkId ||
        current.checkCancelRequested ||
        Date.now() >= deadline
      )
        throw new DomainError('STATE_CONFLICT')
    }
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const guard = byteGuard(row.actualBytes!)
      await pipeline(
        await this.store.read(row.objectKey, abort.signal),
        guard.stream,
        createWriteStream(path, { flags: 'wx', mode: 0o444 }),
        { signal: abort.signal }
      )
      const staged = guard.receipt()
      if (staged.sha256 !== row.sha256) throw new DomainError('FILE_UNAVAILABLE')
      await currentTask()
      const report = await checker.check(path, row.contentType, row.checkId, {
        signal: abort.signal,
        wallMs: Math.max(1, deadline - Date.now())
      })
      stopped = report.processStopped
      if (!stopped) throw new DomainError('FILE_UNAVAILABLE')
      let result = report
      if (report.status === 'clean') {
        const current = await this.digest(row.objectKey, row.actualBytes!, abort.signal)
        if (
          !report.structural ||
          report.bytes !== row.actualBytes ||
          report.sha256 !== row.sha256 ||
          report.contentType !== row.contentType ||
          !report.malware?.clean ||
          report.malware.engine !== 'ClamAV' ||
          !report.malware.version ||
          !report.malware.signatureDate ||
          (row.contentType === 'application/zip' && !validZipCoverage(report.malware)) ||
          current.sha256 !== row.sha256
        )
          result = { status: 'rejected', reason: 'CHECK_MISMATCH', processStopped: true }
      }
      await currentTask()
      await rm(dir, { recursive: true, force: true })
      return await this.finishCheck(row, result)
    } catch (error) {
      abort.abort()
      stopped = await checker.terminate(row.checkId)
      if (!stopped) throw new DomainError('FILE_UNAVAILABLE')
      await rm(dir, { recursive: true, force: true })
      const current = await this.client.privateUpload.findUniqueOrThrow({ where: { id: row.id } })
      if (current.status !== 'checking')
        return { uploadId: row.id, status: current.status, downloadEnabled: false }
      const timed =
        Date.now() >= deadline ||
        current.checkCancelRequested ||
        current.checkDeadlineAt! <= this.now()
      if (error instanceof DomainError && error.code === 'FILE_UNAVAILABLE' && !timed)
        return this.finishCheck(row, {
          status: 'rejected',
          reason: 'CHECK_INCOMPLETE',
          processStopped: true
        })
      return this.finishCheck(row, {
        status: timed ? 'timeout' : 'rejected',
        reason: timed ? 'CHECK_TIMEOUT' : 'CHECK_INCOMPLETE',
        processStopped: true
      })
    } finally {
      clearTimeout(timer)
      clearInterval(watch)
      // Local I/O and this continuation have ended. Container termination is
      // independently required before a reaper may release the global slot.
      await this.client.privateUpload.updateMany({
        where: { id: row.id, checkId: row.checkId },
        data: { checkOwnerStopped: true }
      })
    }
  }
  private async digest(key: string, bytes: number, signal?: AbortSignal): Promise<ObjectReceipt> {
    const guard = byteGuard(bytes),
      stream = await this.store.read(key, signal)
    const { Writable } = await import('node:stream')
    await pipeline(
      stream,
      guard.stream,
      new Writable({
        write(_chunk, _enc, done) {
          done()
        }
      }),
      { signal }
    )
    return guard.receipt()
  }
  private async finishCheck(row: PrivateUpload, report: FileCheckReport) {
    return transact(this.client, async (tx) => {
      await this.quota.lock(tx)
      const current = await this.upload(tx, row.id)
      if (current.status !== 'checking' || current.checkId !== row.checkId)
        throw new DomainError('STATE_CONFLICT')
      if (
        report.status === 'clean' &&
        (current.checkCancelRequested || current.checkDeadlineAt! <= this.now())
      )
        report = { status: 'timeout', reason: 'CHECK_TIMEOUT', processStopped: true }
      const clean = report.status === 'clean',
        status = clean ? 'ready' : report.status === 'timeout' ? 'check_timeout' : 'rejected'
      await tx.privateFileCheck.create({
        data: { id: row.checkId!, uploadId: row.id, report: json(report) }
      })
      if (clean) {
        await tx.privateFileVersion.create({
          data: {
            uploadId: row.id,
            orderId: row.orderId,
            ownerId: row.accountId,
            purpose: row.purpose,
            objectKey: row.objectKey,
            objectVersion: row.id,
            sha256: row.sha256!,
            byteSize: row.actualBytes!,
            contentType: row.contentType,
            filename: row.filename,
            checkId: row.checkId!
          }
        })
        await tx.privateFileQuota.update({
          where: { accountId: row.accountId },
          data: {
            reservedBytes: { decrement: row.declaredBytes },
            usedBytes: { increment: row.actualBytes! },
            activeUploads: { decrement: 1 }
          }
        })
        await tx.privateFileGlobal.update({
          where: { singleton: true },
          data: {
            reservedBytes: { decrement: row.declaredBytes },
            usedBytes: { increment: row.actualBytes! },
            activeUploads: { decrement: 1 }
          }
        })
      }
      await tx.privateUpload.update({
        where: { id: row.id },
        data: { status, failureReason: clean ? null : report.reason, checkOwnerStopped: true }
      })
      await tx.privateFileGlobal.update({
        where: { singleton: true },
        data: { checking: { decrement: 1 } }
      })
      await this.audit(tx, row.id, status, { checkId: row.checkId })
      return { uploadId: row.id, status, downloadEnabled: false }
    })
  }
  async reapChecks(checker: PrivateFileChecker, scratchRoot: string) {
    const rows = await this.client.privateUpload.findMany({
      where: {
        status: 'checking',
        OR: [{ checkDeadlineAt: { lte: this.now() } }, { checkCancelRequested: true }]
      }
    })
    let recovered = 0
    for (const hint of rows) {
      const row = await transact(this.client, async (tx) => {
        await this.quota.lock(tx)
        const row = await this.upload(tx, hint.id)
        if (row.status !== 'checking') return null
        return tx.privateUpload.update({
          where: { id: row.id },
          data: { checkCancelRequested: true }
        })
      })
      if (!row || !row.checkId) continue
      if (!(await checker.terminate(row.checkId))) throw new DomainError('FILE_UNAVAILABLE')
      const current = await this.client.privateUpload.findUniqueOrThrow({ where: { id: row.id } })
      if (current.status !== 'checking') continue
      if (
        !current.checkOwnerStopped &&
        !processHasExited({
          scope: current.checkOwnerScope,
          pid: current.checkOwnerPid,
          start: current.checkOwnerStart
        })
      )
        continue
      await rm(resolve(scratchRoot, row.checkId), { recursive: true, force: true })
      await this.finishCheck(row, {
        status: 'timeout',
        reason: 'WORKER_LOST',
        processStopped: true
      })
      recovered++
    }
    return recovered
  }
}
