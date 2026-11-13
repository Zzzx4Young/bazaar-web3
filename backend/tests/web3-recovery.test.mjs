import test from 'node:test'
import assert from 'node:assert/strict'
const mod = await import('../dist/web3/recovery-report.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const checks = {
  ledgerWitness: true,
  deletionLedger: true,
  deployment: true,
  keys: true,
  dbObjects: true,
  funds: true,
  identities: true,
  fileMappings: true,
  access: true,
  issuance: true,
  inventory: true
}
const input = () => ({
  faultAt: '2026-11-13T01:00:00Z',
  consistentPointAt: '2026-11-12T02:00:00Z',
  observedAt: '2026-11-13T02:00:00Z',
  openedAt: '2026-11-13T02:00:00Z',
  infrastructureAvailable: true,
  independentRpcAvailable: true,
  checks: { ...checks },
  missing: []
})
test('T10/A28: isolated infrastructure startup is partial recovery, never full RTO success', () => {
  assert.equal(typeof mod.evaluateRecovery, 'function')
  const report = mod.evaluateRecovery({
    ...input(),
    checks: { ...checks, access: false },
    openedAt: null
  })
  assert.equal(report.status, 'partial')
  assert.equal(report.rtoSeconds, null)
  assert.equal(report.targetsMet, false)
  assert.equal(report.elapsedSeconds, 3600)
})
test('T10/A27: untrusted ledger blocks recovery even when all other probes are green', () => {
  assert.equal(typeof mod.evaluateRecovery, 'function')
  const report = mod.evaluateRecovery({ ...input(), checks: { ...checks, ledgerWitness: false } })
  assert.equal(report.status, 'blocked')
  assert.equal(report.rtoSeconds, null)
})
test('T10/A28: only complete evidence yields measured consistent RPO and full RTO', () => {
  assert.equal(typeof mod.evaluateRecovery, 'function')
  const report = mod.evaluateRecovery(input())
  assert.equal(report.status, 'full')
  assert.equal(report.rpoSeconds, 82800)
  assert.equal(report.rtoSeconds, 3600)
  assert.equal(report.targetsMet, true)
  assert.equal(mod.evaluateRecovery({ ...input(), missing: ['private mapping'] }).status, 'partial')
  assert.equal(
    mod.evaluateRecovery({ ...input(), consistentPointAt: '2026-11-11T01:00:00Z' }).targetsMet,
    false
  )
  assert.equal(
    mod.evaluateRecovery({ ...input(), independentRpcAvailable: false }).targetsMet,
    false
  )
  assert.equal(
    mod.evaluateRecovery({ ...input(), checks: { ...checks, deletionLedger: undefined } }).status,
    'blocked'
  )
  assert.throws(() =>
    mod.evaluateRecovery({ ...input(), consistentPointAt: '2026-11-14T01:00:00Z' })
  )
})
test('T10: runtime wiring requires an explicit witness; never silently enrol a restored ledger', async () => {
  const witness = await import('../dist/auth/ledger-witness.js')
  assert.equal(typeof witness.requireLedgerWitness, 'function')
  assert.throws(
    () =>
      witness.requireLedgerWitness(
        {},
        { securityLedgerId: '00000000-0000-0000-0000-000000000000' }
      ),
    /WITNESS/
  )
})
