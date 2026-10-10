import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

import { DomainError } from '../common/domain-error.js'
import { transactionPolicy } from './transaction-policy.js'

export type Transaction = Prisma.TransactionClient
export type Checkpoint = (stage: string, tx: Transaction, attempt: number) => Promise<void>
export interface TransactionOptions {
  // Test instrumentation only; never populate from an HTTP request or perform external I/O.
  checkpoint?: Checkpoint
  maxAttempts?: number
  lockTimeoutMs?: number
}

// SQLSTATEs can be wrapped by Prisma's driver adapter or raw-query errors.
export function retryable(error: unknown): boolean {
  if (!error || typeof error !== 'object' || error instanceof DomainError) return false
  const value = error as {
    code?: string
    meta?: { code?: string; driverAdapterError?: unknown }
    cause?: unknown
    originalCode?: string
  }
  return (
    ['P2034', '40001', '40P01', '55P03'].includes(value.code ?? value.originalCode ?? '') ||
    ['40001', '40P01', '55P03'].includes(value.meta?.code ?? '') ||
    retryable(value.meta?.driverAdapterError) ||
    retryable(value.cause)
  )
}

export async function transact<T>(
  client: PrismaClient,
  work: (tx: Transaction, attempt: number) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const attempts = options.maxAttempts ?? transactionPolicy.defaultAttempts
  const timeout = options.lockTimeoutMs ?? transactionPolicy.defaultLockTimeoutMs
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > transactionPolicy.maxAttempts ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > transactionPolicy.maxLockTimeoutMs
  ) {
    throw new Error('Invalid transaction limits')
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${timeout}ms`}, true)`
          await options.checkpoint?.('begin', tx, attempt)
          return work(tx, attempt)
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: transactionPolicy.maxWaitMs,
          timeout: transactionPolicy.timeoutMs
        }
      )
    } catch (error) {
      if (!retryable(error)) throw error
      if (attempt >= attempts) throw new DomainError('RETRY_EXHAUSTED')
      await new Promise((resolve) => setTimeout(resolve, attempt * transactionPolicy.retryBackoffMs))
    }
  }
}
