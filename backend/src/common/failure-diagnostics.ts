// Internal diagnostics contain no messages, stack traces, SQL, arguments or driver metadata.
export type TransactionPhase = 'begin' | 'work' | 'commit'
interface TransactionFailure {
  phase: TransactionPhase
  attempt: number
}
const transactions = new WeakMap<object, TransactionFailure>()
const classes = new Set([
  'Error', 'TypeError', 'RangeError', 'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError', 'PrismaClientInitializationError', 'DriverAdapterError'
])
const codes = new Set([
  'P2002', 'P2003', 'P2010', 'P2024', 'P2028', 'P2034',
  '40001', '40P01', '55P03', '57014', '53300', '57P01', '08006', '42501'
])
export function noteTransactionFailure(error: unknown, phase: TransactionPhase, attempt: number) {
  if (error && typeof error === 'object') transactions.set(error, { phase, attempt })
}
export function safeFailure(error: unknown) {
  const found = new Set<string>(), seen = new Set<object>()
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return
    seen.add(value)
    const row = value as Record<string, unknown>
    for (const key of ['code', 'originalCode']) {
      if (typeof row[key] === 'string' && codes.has(row[key])) found.add(row[key])
    }
    for (const key of ['cause', 'meta', 'driverAdapterError']) visit(row[key], depth + 1)
  }
  visit(error, 0)
  const name = error instanceof Error ? error.name : 'Unknown'
  const transaction = error && typeof error === 'object' ? transactions.get(error) : undefined
  return {
    class: classes.has(name) ? name : 'Unknown',
    codes: [...found],
    ...(transaction ? { transaction } : {})
  }
}
