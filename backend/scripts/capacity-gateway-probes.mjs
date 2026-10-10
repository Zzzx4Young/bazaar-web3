import assert from 'node:assert/strict'
import { monotonicNow, monotonicElapsedMs } from './capacity-monotonic.mjs'
import { performance } from 'node:perf_hooks'
import { capacityDatabaseFaultPolicy } from './capacity-database-fault.mjs'
import { recoverOriginalKey } from './ha-original-key-recovery.mjs'

// Only test-owned processes and sessions. Probe requests are reported separately from load arrivals.
export function capacityGatewayProbes({ fault, writes, instances, processes, post }) {
  const tasks = []
  let failure, blocked = false, restored = false
  const api = instances[capacityDatabaseFaultPolicy.gatewayApiIndex]
  const probe = writes.originalReplayProbe()
  const direct = (...args) => post(api.port, ...args)
  const proof = (fault.report.gatewayProbe = { orderId: probe.orderId, apiPid: api.pid })
  const handle = (message) => {
    if (!['database-gateway-killed', 'database-gateway-restored'].includes(message?.event)) return
    tasks.push((async () => {
      if (message.event === 'database-gateway-killed') {
        assert.equal(blocked, false, 'Gateway kill probe repeated')
        blocked = true
        assert.equal((await direct('/api/health/ready')).status, 503)
        proof.liveStatus = (await direct('/api/health/live')).status
        assert.equal(proof.liveStatus, 200)
        proof.blockedStatus = (await probe.request(direct)).status
        proof.blockedAt = Date.now()
        proof.blockedMonoNs = monotonicNow()
        assert.equal(proof.blockedStatus, 503, 'Failed gateway original API acknowledged a replay')
      } else {
        assert.equal(restored, false, 'Gateway recovery probe repeated')
        restored = true
        const deadlineMs = performance.now() + capacityDatabaseFaultPolicy.rtoMs -
          monotonicElapsedMs(fault.report.startedMonoNs, monotonicNow())
        proof.replay = await recoverOriginalKey({ request: () => probe.request(direct),
          orderId: probe.orderId, deadlineMs, pollMs: capacityDatabaseFaultPolicy.gatewayProbePollMs })
        proof.recoveredAt = Date.now()
        proof.recoveredMonoNs = monotonicNow()
        proof.recoveredOriginalOrder = true
        assert.equal((await direct('/api/health/ready')).status, 200)
        assert.ok(processes.every((child) => child.exitCode === null && child.signalCode === null))
        proof.originalApiProcessesSurvived = true
      }
    })().catch((error) => { failure = error }))
  }
  process.on('message', handle)
  return {
    finish: async () => {
      await Promise.all(tasks)
      process.off('message', handle)
      if (failure) throw failure
      assert.ok(blocked && restored, 'Missing actual gateway fault probes')
    },
    close: () => process.off('message', handle)
  }
}
