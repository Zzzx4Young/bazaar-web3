import assert from 'node:assert/strict'
import { monotonicNs, monotonicElapsedMs } from './capacity-monotonic.mjs'

export const capacityDatabaseFaultPolicy = {
  injectAfterMs: 20000,
  rtoMs: 60000,
  controlTimeoutMs: 120000,
  replicaProtectionMs: 15000,
  gatewayProtectionMs: 15000,
  gatewayApiIndex: 1,
  gatewayProbePollMs: 250
}
const transientCodes = new Set([
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT'
])

export function capacityDatabaseFault(mode = 'primary-kill') {
  assert.ok(['primary-kill', 'replicas-stop', 'gateway-kill'].includes(mode))
  const report = { mode, acknowledgments: [] }
  return {
    report,
    update(message) {
      if (message.event === 'database-fault-started') {
        assert.equal(report.startedAt, undefined)
        assert.ok(Number.isSafeInteger(message.startedAt))
        report.startedAt = message.startedAt
        if (mode === 'gateway-kill') {
          monotonicNs(message.startedMonoNs)
          report.startedMonoNs = message.startedMonoNs
        }
      } else if (message.event === 'database-primary-killed') {
        assert.ok(message.killedAt >= report.startedAt)
        report.killedAt = message.killedAt
      } else if (message.event === 'database-gateway-kill-starting') {
        assert.equal(mode, 'gateway-kill')
        assert.ok(Number.isSafeInteger(message.killCommandStartedAt))
        monotonicElapsedMs(report.startedMonoNs, message.killCommandStartedMonoNs)
        report.killCommandStartedAt = message.killCommandStartedAt
        report.killCommandStartedMonoNs = message.killCommandStartedMonoNs
      } else if (message.event === 'database-gateway-killed') {
        assert.equal(mode, 'gateway-kill')
        assert.ok(Number.isSafeInteger(message.killedAt))
        report.killedAt = message.killedAt
        monotonicElapsedMs(report.killCommandStartedMonoNs, message.killedMonoNs)
        report.killedMonoNs = message.killedMonoNs
      } else if (message.event === 'database-gateway-restored') {
        assert.equal(mode, 'gateway-kill')
        assert.ok(Number.isSafeInteger(message.restartAt) && Number.isSafeInteger(message.restoredAt))
        report.restartAt = message.restartAt
        report.restoredAt = message.restoredAt
        report.endpointUnchanged = message.endpointUnchanged
        monotonicElapsedMs(report.killedMonoNs, message.restartMonoNs)
        monotonicElapsedMs(message.restartMonoNs, message.restoredMonoNs)
        report.restartMonoNs = message.restartMonoNs
        report.restoredMonoNs = message.restoredMonoNs
      } else if (message.event === 'database-replicas-stopped') {
        assert.equal(mode, 'replicas-stop')
        assert.ok(message.stoppedAt >= report.startedAt)
        assert.ok(message.zeroReplicaObservedAt >= message.stoppedAt)
        report.stoppedAt = message.stoppedAt
        report.zeroReplicaObservedAt = message.zeroReplicaObservedAt
      } else if (message.event === 'database-replicas-restarting') {
        assert.equal(mode, 'replicas-stop')
        assert.ok(message.restartAt >= report.zeroReplicaObservedAt)
        report.restartAt = message.restartAt
      } else if (message.event === 'database-fault-complete') {
        assert.ok(['pg1', 'pg2', 'pg3'].includes(message.primary))
        report.primary = message.primary
        report.complete = true
        report.restoredAt = message.restoredAt ?? report.restoredAt
        report.initialPrimary = message.initialPrimary
      }
    },
    writeSucceeded(requestStartedAt, acknowledgedAt, requestMonoNs, acknowledgedMonoNs) {
      if (
        report.startedAt !== undefined &&
        acknowledgedAt >= report.startedAt &&
        acknowledgedAt <= report.startedAt + capacityDatabaseFaultPolicy.rtoMs
      )
        report.acknowledgments.push({ requestStartedAt, acknowledgedAt })
      if (mode === 'gateway-kill') {
        if (report.firstWrite || report.killedMonoNs === undefined ||
          monotonicNs(requestMonoNs) < monotonicNs(report.killedMonoNs)) return
        report.firstWrite = { requestStartedAt, acknowledgedAt,
          recoveryMs: monotonicElapsedMs(report.startedMonoNs, acknowledgedMonoNs) }
        return
      }
      const resumeBoundary = mode === 'replicas-stop' ? report.restartAt : report.killedAt
      if (report.firstWrite || resumeBoundary === undefined || requestStartedAt < resumeBoundary)
        return
      report.firstWrite = {
        requestStartedAt,
        acknowledgedAt,
        recoveryMs: acknowledgedAt - report.startedAt
      }
    },
    expectedFailure(code, at, atMonoNs) {
      if (mode === 'gateway-kill') {
        if (report.killCommandStartedMonoNs === undefined || atMonoNs === undefined) return false
        return monotonicNs(atMonoNs) >= monotonicNs(report.killCommandStartedMonoNs) &&
          monotonicElapsedMs(report.startedMonoNs, atMonoNs) <= capacityDatabaseFaultPolicy.rtoMs &&
          (report.gatewayProbe?.recoveredMonoNs === undefined ||
            monotonicNs(atMonoNs) <= monotonicNs(report.gatewayProbe.recoveredMonoNs)) &&
          transientCodes.has(code)
      }
      return (
        report.startedAt !== undefined &&
        at >= (mode === 'gateway-kill' ? report.killedAt : report.startedAt) &&
        at <= Math.min(report.startedAt + capacityDatabaseFaultPolicy.rtoMs,
          mode === 'gateway-kill' ? report.gatewayProbe?.recoveredAt ?? Infinity : Infinity) &&
        transientCodes.has(code)
      )
    },
    verify() {
      assert.equal(report.complete, true, 'Database fault controller did not complete')
      if (mode === 'primary-kill')
        assert.ok(report.killedAt !== undefined, 'No confirmed primary kill')
      else if (mode === 'gateway-kill') {
        assert.ok(report.killedAt !== undefined && monotonicElapsedMs(report.killedMonoNs, report.restartMonoNs) >= capacityDatabaseFaultPolicy.gatewayProtectionMs)
        assert.equal(report.endpointUnchanged, true)
        assert.equal(report.primary, report.initialPrimary)
        const probe = report.gatewayProbe
        assert.ok(probe && monotonicNs(probe.blockedMonoNs) >= monotonicNs(report.killedMonoNs) &&
          monotonicNs(probe.blockedMonoNs) < monotonicNs(report.restartMonoNs))
        assert.equal(probe.blockedStatus, 503)
        assert.equal(probe.liveStatus, 200)
        assert.equal(probe.recoveredOriginalOrder, true)
        assert.equal(probe.originalApiProcessesSurvived, true)
        assert.ok(monotonicNs(probe.recoveredMonoNs) >= monotonicNs(report.restoredMonoNs))
        probe.recoveryMs = monotonicElapsedMs(report.startedMonoNs, probe.recoveredMonoNs)
        assert.ok(probe.recoveryMs <= capacityDatabaseFaultPolicy.rtoMs, 'Original API replay exceeded 60 seconds')
      } else {
        assert.ok(report.stoppedAt !== undefined && report.restartAt !== undefined)
        assert.equal(
          report.primary,
          report.initialPrimary,
          'Unexpected primary change during replica loss'
        )
        assert.ok(
          report.restartAt - report.zeroReplicaObservedAt >=
            capacityDatabaseFaultPolicy.replicaProtectionMs,
          'Replica protection observation too short'
        )
        report.protection = {
          startedAt: report.stoppedAt,
          endedAt: report.restartAt,
          acknowledgedNewWrites: report.acknowledgments.filter(
            (ack) =>
              ack.requestStartedAt >= report.stoppedAt && ack.acknowledgedAt < report.restartAt
          ).length
        }
        assert.equal(
          report.protection.acknowledgedNewWrites,
          0,
          'New write acknowledged without replicas'
        )
      }
      assert.ok(report.firstWrite, 'No successful new write after database recovery')
      assert.ok(
        report.firstWrite.recoveryMs >= 0 &&
          report.firstWrite.recoveryMs <= capacityDatabaseFaultPolicy.rtoMs,
        'Database write recovery exceeded 60 seconds'
      )
    }
  }
}
