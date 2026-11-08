import { createHash } from 'node:crypto'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { web3Policy } from '../web3/web3-policy.js'

export interface PrivateFileBudget {
  globalBytes: number
  globalUploads: number
  checkConcurrency: number
  checkQueue: number
  checkWallMs?: number
}
export const localPrivateBudget: PrivateFileBudget = Object.freeze({
  globalBytes: 8_000_000_000,
  globalUploads: 8,
  checkConcurrency: 1,
  checkQueue: 4
})
export function validateBudget(p: PrivateFileBudget) {
  if (
    !Number.isSafeInteger(p.globalBytes) ||
    p.globalBytes < 500_000_000 ||
    p.globalBytes > 100_000_000_000 ||
    !Number.isInteger(p.globalUploads) ||
    p.globalUploads < 1 ||
    p.globalUploads > 100 ||
    !Number.isInteger(p.checkConcurrency) ||
    p.checkConcurrency < 1 ||
    p.checkConcurrency > 4 ||
    !Number.isInteger(p.checkQueue) ||
    p.checkQueue < 1 ||
    p.checkQueue > 100
  )
    throw new Error('Invalid private file capacity budget')
  if (
    p.checkWallMs !== undefined &&
    (!Number.isInteger(p.checkWallMs) || p.checkWallMs < 10 || p.checkWallMs > 120000)
  )
    throw new Error('Invalid private check deadline')
  return p
}
export class PrivateFileQuotaService {
  private readonly policyHash: string
  constructor(readonly budget: PrivateFileBudget) {
    validateBudget(budget)
    this.policyHash = createHash('sha256')
      .update(
        JSON.stringify([
          budget.globalBytes,
          budget.globalUploads,
          budget.checkConcurrency,
          budget.checkQueue,
          web3Policy.accountStorageBytes,
          web3Policy.activeUploads,
          web3Policy.uploadsPerRollingHour,
          budget.checkWallMs ?? 120000
        ])
      )
      .digest('hex')
  }
  async lock(tx: Transaction, accountId?: string) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('private-files:' || current_schema(),0))`
    const global = await tx.privateFileGlobal.upsert({
      where: { singleton: true },
      create: { singleton: true, policyHash: this.policyHash },
      update: {}
    })
    if (global.maintenance || global.policyHash !== this.policyHash)
      throw new DomainError('FILE_UNAVAILABLE')
    if (accountId) {
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`
      const a = await tx.account.findUnique({ where: { id: accountId } })
      if (a?.status !== 'active' || a.role !== 'participant') throw new DomainError('FORBIDDEN')
      await tx.privateFileQuota.upsert({ where: { accountId }, create: { accountId }, update: {} })
    }
    return global
  }
  async reserve(tx: Transaction, accountId: string, bytes: number, now: Date) {
    const global = await this.lock(tx, accountId),
      quota = await tx.privateFileQuota.findUniqueOrThrow({ where: { accountId } })
    const since = new Date(now.getTime() - 3600_000),
      minute = new Date(now.getTime() - 60_000)
    if (
      quota.activeUploads >= web3Policy.activeUploads ||
      global.activeUploads >= this.budget.globalUploads ||
      quota.reservedBytes + quota.usedBytes + BigInt(bytes) >
        BigInt(web3Policy.accountStorageBytes) ||
      global.reservedBytes + global.usedBytes + BigInt(bytes) > BigInt(this.budget.globalBytes) ||
      (await tx.privateUpload.count({ where: { accountId, createdAt: { gt: since } } })) >=
        web3Policy.uploadsPerRollingHour ||
      (await tx.privateUpload.count({ where: { createdAt: { gt: minute } } })) >= 20
    )
      throw new DomainError('FILE_LIMIT_REACHED')
    await tx.privateFileQuota.update({
      where: { accountId },
      data: { reservedBytes: { increment: bytes }, activeUploads: { increment: 1 } }
    })
    await tx.privateFileGlobal.update({
      where: { singleton: true },
      data: { reservedBytes: { increment: bytes }, activeUploads: { increment: 1 } }
    })
  }
}
