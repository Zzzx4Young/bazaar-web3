import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { setInterval, clearInterval } from 'node:timers'
import { isDatabaseUnavailable } from '../dist/database/database-errors.js'
import { capacityClock } from './capacity-clock.mjs'

export async function capacityResources(
  processes,
  client,
  role,
  databaseTopology = 'single',
  expectedOutage = () => false
) {
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
  const started = performance.now()
  const clock = capacityClock()
  const generatorCpu = process.cpuUsage()
  const samples = []
  const unavailableSamples = []
  const api = new Map()
  let running = false,
    failure = false
  async function sample() {
    if (running) return
    running = true
    try {
      clock.sample()
      for (const child of processes) {
        if (child.exitCode !== null || child.signalCode !== null) continue
        try {
          const [status, stat] = await Promise.all([
            readFile(`/proc/${child.pid}/status`, 'utf8'),
            readFile(`/proc/${child.pid}/stat`, 'utf8')
          ])
          const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
          const ticks = Number(fields[11]) + Number(fields[12])
          const entry = api.get(child.pid) ?? {
            pid: child.pid,
            peakRssBytes: 0,
            firstCpuTicks: ticks,
            lastCpuTicks: ticks
          }
          entry.peakRssBytes = Math.max(entry.peakRssBytes, rss)
          entry.lastCpuTicks = ticks
          api.set(child.pid, entry)
        } catch {
          /* A killed process can disappear between the two reads. */
        }
      }
      const connections = await client.$queryRaw`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active,
          count(*) FILTER (WHERE wait_event = 'SyncRep')::int AS "syncWaiting",
          count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS "lockWaiting",
          coalesce(max(extract(epoch FROM clock_timestamp() - xact_start) * 1000), 0)::float8 AS "oldestTransactionMs"
        FROM pg_stat_activity WHERE usename = ${role}`
      const replication =
        databaseTopology === 'synchronous-ha'
          ? (
              await client.$queryRaw`
        SELECT count(*)::int AS replicas,
          count(*) FILTER (WHERE state = 'streaming')::int AS streaming,
          count(*) FILTER (WHERE sync_state = 'sync')::int AS synchronous,
          current_setting('synchronous_commit') AS commit_mode,
          current_setting('synchronous_standby_names') AS standby_names
        FROM pg_stat_replication`
            )[0]
          : undefined
      samples.push({
        at: Date.now(),
        elapsedMs: Math.round(performance.now() - started),
        generatorRssBytes: process.memoryUsage().rss,
        ...connections[0],
        replication
      })
    } catch (error) {
      const expected = isDatabaseUnavailable(error) && expectedOutage()
      unavailableSamples.push({ elapsedMs: Math.round(performance.now() - started), expected })
      if (!expected) failure = true
    } finally {
      running = false
    }
  }
  await sample()
  const timer = setInterval(() => {
    void sample().catch(() => {
      failure = true
    })
  }, 250)
  return async () => {
    clearInterval(timer)
    while (running) await new Promise((resolve) => setTimeout(resolve, 5))
    await sample()
    return {
      sampleIntervalMs: 250,
      clock: clock.report(),
      failedSamples: failure,
      unavailableSamples,
      elapsedMs: performance.now() - started,
      generatorCpuMicroseconds: process.cpuUsage(generatorCpu),
      samples,
      api: [...api.values()].map(({ firstCpuTicks, lastCpuTicks, ...entry }) => ({
        ...entry,
        observedCpuSeconds: (lastCpuTicks - firstCpuTicks) / ticksPerSecond
      }))
    }
  }
}
