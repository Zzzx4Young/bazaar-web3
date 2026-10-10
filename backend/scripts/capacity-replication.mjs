import assert from 'node:assert/strict'

export function verifyCapacityReplication(samples, fault) {
  assert.ok(samples.length, 'Missing replication samples')
  if (fault?.report.mode === 'replicas-stop') {
    const { stoppedAt, restartAt, acknowledgments } = fault.report
    assert.ok(
      Number.isSafeInteger(stoppedAt) && restartAt > stoppedAt,
      'Missing confirmed replica protection boundaries'
    )
    // A point sample cannot establish replica state until the next sample: a
    // restarted standby can become synchronous between the two observations.
    // The controller proves both containers remain stopped throughout this hold.
    assert.ok(
      !acknowledgments.some(
        (ack) => ack.requestStartedAt >= stoppedAt && ack.acknowledgedAt < restartAt
      ),
      'Write acknowledged while all replicas were stopped'
    )
  }
  // Samples establish configuration/topology at observation points, not a
  // continuous no-replica interval. Command durability is checked by original-key
  // business audits and the separately controlled all-replicas-stopped scenario.
  for (const sample of samples) {
    const state = sample.replication
    assert.equal(state.commit_mode, 'remote_apply')
    assert.ok(state.standby_names?.trim(), 'Synchronous commit barrier was disabled')
    const duringFault = fault?.report.mode !== 'gateway-kill' &&
      (fault?.expectedFailure('HTTP_503', sample.at) ?? false)
    if (!duringFault) {
      assert.ok(
        state.replicas === 2 && state.streaming === 2 && state.synchronous >= 1,
        'Healthy replication unavailable outside fault window'
      )
    } else {
      assert.ok(
        state.synchronous >= 0 &&
          state.synchronous <= state.streaming &&
          state.streaming <= state.replicas &&
          state.replicas <= 2
      )
    }
  }
  const final = samples.at(-1).replication
  assert.ok(
    final.replicas === 2 && final.streaming === 2 && final.synchronous >= 1,
    'Final replication did not recover'
  )
}
