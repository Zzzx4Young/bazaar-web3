import { type PrismaClient } from '../generated/prisma/client.js'
import { rateBucketCleanupBatchSize, rateBucketCleanupIntervalMs } from './auth-policy.js'

export async function pruneExpiredAuthRateBuckets(
  client: PrismaClient,
  batchSize = rateBucketCleanupBatchSize
) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > rateBucketCleanupBatchSize)
    throw new Error('Invalid auth rate cleanup batch size')
  return client.$executeRaw`
    DELETE FROM "AuthRateBucket" WHERE "key" IN (
      SELECT "key" FROM "AuthRateBucket"
      WHERE "windowEnd" <= statement_timestamp()
      ORDER BY "windowEnd", "key"
      LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
    )`
}

export function startAuthRateCleanup(
  client: PrismaClient,
  options: { intervalMs?: number; onError?: () => void } = {}
) {
  const intervalMs = options.intervalMs ?? rateBucketCleanupIntervalMs
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1)
    throw new Error('Invalid auth rate cleanup interval')
  let running = false
  let stopped = false
  async function sweep() {
    if (running || stopped) return
    running = true
    try {
      await pruneExpiredAuthRateBuckets(client)
    } catch {
      options.onError?.()
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => { void sweep() }, intervalMs)
  timer.unref()
  void sweep()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
