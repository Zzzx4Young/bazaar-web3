import { type PrismaClient } from '../generated/prisma/client.js'
import { OrderCommands } from './order-commands.js'

const defaultAgeMs = 30 * 60 * 1000
const defaultIntervalMs = 60 * 1000

export function startOrderExpiry(
  client: PrismaClient,
  options: { ageMs?: number; intervalMs?: number; onError?: () => void } = {}
) {
  const ageMs = options.ageMs ?? defaultAgeMs
  const intervalMs = options.intervalMs ?? defaultIntervalMs
  if (!Number.isSafeInteger(ageMs) || ageMs < 1 ||
    !Number.isSafeInteger(intervalMs) || intervalMs < 1)
    throw new Error('Invalid order expiry schedule')
  const commands = new OrderCommands(client)
  let running = false
  let stopped = false
  async function sweep() {
    if (running || stopped) return
    running = true
    try {
      await commands.expirePendingPaymentOrders(new Date(Date.now() - ageMs))
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
