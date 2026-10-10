import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityDatabaseFault } from '../scripts/capacity-database-fault.mjs'

test('write RTO requires a request started after confirmed kill, not a late pre-fault response', () => {
  const fault = capacityDatabaseFault()
  fault.update({ event: 'database-fault-started', startedAt: 1000 })
  fault.update({ event: 'database-primary-killed', killedAt: 1200 })
  fault.writeSucceeded(1100, 1400)
  assert.equal(fault.report.firstWrite, undefined)
  fault.writeSucceeded(1300, 1500)
  assert.equal(fault.report.firstWrite.recoveryMs, 500)
  assert.equal(fault.expectedFailure('HTTP_503', 2000), true)
  assert.equal(fault.expectedFailure('HTTP_500', 2000), false)
  assert.equal(fault.expectedFailure('HTTP_503', 999), false)
  assert.equal(fault.expectedFailure('HTTP_503', 61001), false)
  fault.update({ event: 'database-fault-complete', primary: 'pg2' })
  fault.verify()
})

test('all-replica loss forbids successful new writes throughout the confirmed protection interval', () => {
  const fault = capacityDatabaseFault('replicas-stop')
  fault.update({ event: 'database-fault-started', startedAt: 1000 })
  fault.update({ event: 'database-replicas-stopped', stoppedAt: 1200, zeroReplicaObservedAt: 1250 })
  // A late pre-fault acknowledgment is distinct from a write started without replicas.
  fault.writeSucceeded(1100, 1400)
  fault.update({ event: 'database-replicas-restarting', restartAt: 17000 })
  fault.writeSucceeded(17500, 18000)
  fault.update({ event: 'database-fault-complete', primary: 'pg1', initialPrimary: 'pg1' })
  fault.verify()
  assert.equal(fault.report.protection.acknowledgedNewWrites, 0)
  assert.equal(fault.report.firstWrite.recoveryMs, 17000)
  fault.writeSucceeded(1300, 16000)
  assert.throws(() => fault.verify(), /without replicas/)
})

test('incomplete fault or recovery beyond 60 seconds cannot pass', () => {
  const fault = capacityDatabaseFault()
  assert.throws(() => fault.verify())
  fault.update({ event: 'database-fault-started', startedAt: 1000 })
  fault.update({ event: 'database-primary-killed', killedAt: 1200 })
  fault.writeSucceeded(62000, 63000)
  fault.update({ event: 'database-fault-complete', primary: 'pg2' })
  assert.throws(() => fault.verify(), /60 seconds/)
})

test('gateway-only fault requires original API rejection and replay recovery with healthy primary unchanged', () => {
  const fault = capacityDatabaseFault('gateway-kill')
  fault.update({ event: 'database-fault-started', startedAt: 1000, startedMonoNs: '1000000000' })
  fault.update({ event: 'database-gateway-kill-starting', killCommandStartedAt: 1120, killCommandStartedMonoNs: '1120000000' })
  assert.equal(fault.expectedFailure('HTTP_503', 1150, '1150000000'), true)
  fault.update({ event: 'database-gateway-killed', killedAt: 1200, killedMonoNs: '1200000000' })
  assert.equal(fault.expectedFailure('HTTP_503', 1100, '1100000000'), false)
  // A misleading wall-clock jump cannot make a pre-kill request a post-kill probe.
  fault.writeSucceeded(2000, 2500, '1100000000', '1500000000')
  assert.equal(fault.report.firstWrite, undefined)
  fault.writeSucceeded(1300, 1500, '1300000000', '1500000000')
  fault.update({ event: 'database-gateway-restored', restartAt: 17000, restoredAt: 17200, endpointUnchanged: true, restartMonoNs: '17000000000', restoredMonoNs: '17200000000' })
  fault.update({ event: 'database-fault-complete', primary: 'pg1', initialPrimary: 'pg1' })
  assert.throws(() => fault.verify())
  fault.report.gatewayProbe = { blockedAt: 1500, blockedMonoNs: '1500000000', blockedStatus: 503, liveStatus: 200,
    recoveredAt: 18000, recoveredMonoNs: '18000000000', recoveredOriginalOrder: true, originalApiProcessesSurvived: true }
  fault.verify()
  assert.equal(fault.expectedFailure('HTTP_503', 18001, '18001000000'), false)
  fault.report.gatewayProbe.recoveredAt = 62000
  fault.report.gatewayProbe.recoveredMonoNs = '62000000000'
  assert.throws(() => fault.verify(), /60 seconds/)
})
