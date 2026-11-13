const required = [
  'ledgerWitness',
  'deletionLedger',
  'deployment',
  'keys',
  'dbObjects',
  'funds',
  'identities',
  'fileMappings',
  'access',
  'issuance',
  'inventory'
] as const
export interface RecoveryEvidence {
  faultAt: string
  consistentPointAt: string | null
  observedAt: string
  openedAt: string | null
  infrastructureAvailable: boolean
  independentRpcAvailable: boolean
  checks: Partial<Record<(typeof required)[number], boolean>>
  missing: string[]
}
// Report only: callers must supply actual independently obtained check results.
// This function never activates a checkpoint or grants any runtime permission.
export function evaluateRecovery(e: RecoveryEvidence) {
  const time = (s: string) => {
    const n = Date.parse(s)
    if (!Number.isFinite(n)) throw new Error('Invalid recovery time')
    return n
  }
  const fault = time(e.faultAt),
    observed = time(e.observedAt),
    point = e.consistentPointAt === null ? null : time(e.consistentPointAt),
    opened = e.openedAt === null ? null : time(e.openedAt)
  if (
    observed < fault ||
    (point !== null && point > fault) ||
    (opened !== null && (opened < fault || opened > observed))
  )
    throw new Error('Inconsistent recovery timeline')
  const incomplete = required.filter((k) => e.checks[k] !== true)
  const blocked = e.checks.ledgerWitness !== true || e.checks.deletionLedger !== true
  const full =
    !blocked &&
    incomplete.length === 0 &&
    e.missing.length === 0 &&
    opened !== null &&
    point !== null
  const rpoSeconds = point === null ? null : (fault - point) / 1000
  const rtoSeconds = full ? (opened! - fault) / 1000 : null
  const prerequisitesMet = e.infrastructureAvailable === true && e.independentRpcAvailable === true
  return {
    status: blocked ? ('blocked' as const) : full ? ('full' as const) : ('partial' as const),
    rpoSeconds,
    rtoSeconds,
    elapsedSeconds: (observed - fault) / 1000,
    prerequisitesMet,
    incomplete,
    missing: [...e.missing],
    targetsMet: full && prerequisitesMet && rpoSeconds! <= 86400 && rtoSeconds! <= 14400
  }
}
