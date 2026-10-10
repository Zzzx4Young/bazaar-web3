// Keep availability classification separate from transaction replay eligibility.
// A disconnected COMMIT has an unknown outcome and must retain its original idempotency key.
const unavailableCodes = new Set([
  'P1001',
  'P1002',
  'P1017',
  'P2024',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  '08000',
  '08001',
  '08003',
  '08006',
  '08007',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  // A former primary can reject writes as read-only before its pooled connections close.
  '25006'
])
const unavailableKinds = new Set(['DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout'])
// pg/pg-pool also emit these exact Error messages without a code; never use substring matching.
const unavailableMessages = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect'
])
const maxErrorObjects = 16

export function isDatabaseUnavailable(error: unknown): boolean {
  const pending: unknown[] = [error]
  const visited = new Set<object>()
  while (pending.length && visited.size < maxErrorObjects) {
    const next = pending.pop()
    if (!next || typeof next !== 'object' || visited.has(next)) continue
    visited.add(next)
    const value = next as {
      code?: string
      originalCode?: string
      kind?: string
      cause?: unknown
      meta?: unknown
      driverAdapterError?: unknown
    }
    if (
      unavailableCodes.has(value.code ?? '') ||
      unavailableCodes.has(value.originalCode ?? '') ||
      unavailableKinds.has(value.kind ?? '') ||
      (next instanceof Error && unavailableMessages.has(next.message))
    )
      return true
    pending.push(value.cause, value.meta, value.driverAdapterError)
  }
  return false
}
