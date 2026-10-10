import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyCapacityReplication } from '../scripts/capacity-replication.mjs'

const blocked = {
  at: 1000,
  replication: {
    replicas: 1,
    streaming: 1,
    synchronous: 0,
    commit_mode: 'remote_apply',
    standby_names: '__patroni_strict_sync_replica_placeholder__'
  }
}
const healthy = {
  at: 2000,
  replication: {
    replicas: 2,
    streaming: 2,
    synchronous: 1,
    commit_mode: 'remote_apply',
    standby_names: 'pg2'
  }
}
const fault = {
  expectedFailure: (_code, at) => at === 1000,
  report: { acknowledgments: [{ acknowledgedAt: 2100 }] }
}

test('bounded election samples permit paused writes only with a nonempty synchronous barrier', () => {
  verifyCapacityReplication([blocked, healthy], fault)
  assert.throws(() => verifyCapacityReplication([blocked, healthy]), /replication/)
  assert.throws(
    () =>
      verifyCapacityReplication(
        [{ ...blocked, replication: { ...blocked.replication, standby_names: '' } }, healthy],
        fault
      ),
    /barrier/
  )
  assert.throws(() =>
    verifyCapacityReplication(
      [{ ...blocked, replication: { ...blocked.replication, commit_mode: 'off' } }, healthy],
      fault
    )
  )
})

test('a primary recovery acknowledgment cannot be judged against an earlier point sample', () => {
  verifyCapacityReplication([blocked, healthy], {
    ...fault,
    report: { mode: 'primary-kill', acknowledgments: [{ acknowledgedAt: 1500 }] }
  })
})

test('replica loss uses confirmed stopped containers rather than extrapolating a sample past restart', () => {
  const report = {
    mode: 'replicas-stop',
    stoppedAt: 900,
    restartAt: 1400,
    acknowledgments: [{ requestStartedAt: 1450, acknowledgedAt: 1500 }]
  }
  verifyCapacityReplication([blocked, healthy], { ...fault, report })
  assert.throws(
    () =>
      verifyCapacityReplication([blocked, healthy], {
        ...fault,
        report: { ...report, acknowledgments: [{ requestStartedAt: 1100, acknowledgedAt: 1200 }] }
      }),
    /acknowledged/
  )
})

test('a TCP gateway fault cannot waive synchronous database health', () => {
  const gatewayFault = { ...fault, report: { mode: 'gateway-kill' } }
  assert.throws(() => verifyCapacityReplication([blocked, healthy], gatewayFault), /replication/)
  verifyCapacityReplication([healthy], gatewayFault)
})
