import { type PrismaClient } from '../generated/prisma/client.js'
import { OrderCommands, type OrderExpiryCursor } from './order-commands.js'
import {
  maxOrderExpiryBatchSize, orderExpiryBatchSize, orderExpiryIntervalMs, pendingPaymentAgeMs
} from './order-expiry-policy.js'

export function startOrderExpiry(
  client: PrismaClient,
  options: { ageMs?: number; intervalMs?: number; batchSize?: number; onError?: () => void } = {}
) {
  const ageMs = options.ageMs ?? pendingPaymentAgeMs
  const intervalMs = options.intervalMs ?? orderExpiryIntervalMs
  const batchSize = options.batchSize ?? orderExpiryBatchSize
  if (!Number.isSafeInteger(ageMs) || ageMs < 1 ||
    !Number.isSafeInteger(intervalMs) || intervalMs < 1 ||
    !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > maxOrderExpiryBatchSize)
    throw new Error('Invalid order expiry schedule')
  const commands = new OrderCommands(client)
  let running = false
  let stopped = false
  let cursor: OrderExpiryCursor | null = null
  async function sweep() {
    if (running || stopped) return
    running = true
    try {
      const result = await commands.expirePendingPaymentOrders(new Date(Date.now() - ageMs), {
        limit: batchSize,
        ...(cursor ? { after: cursor } : {})
      })
      cursor = result.nextCursor
      if (result.failed.length) options.onError?.()
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
