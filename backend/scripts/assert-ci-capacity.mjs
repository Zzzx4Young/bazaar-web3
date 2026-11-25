import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
// Two tasks reserve up to 8 GB inclusive of 4.4 GB tmpfs, plus staged input and service/OS headroom.
const info = await readFile('/proc/meminfo', 'utf8')
const available = Number(info.match(/^MemAvailable:\s+(\d+) kB$/m)?.[1]) * 1024
let cgroup = Infinity
try {
  const value = (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim()
  if (value !== 'max') cgroup = Number(value)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const bytes = Math.min(available, cgroup)
console.log(JSON.stringify({ event: 'private_capacity_admission', availableBytes: bytes,
  requiredBytes: 12_000_000_000, cpus: availableParallelism(), requiredCpus: 2 }))
if (!Number.isFinite(bytes) || bytes < 12_000_000_000 || availableParallelism() < 2)
  throw new Error('Full dual-task capacity requires 12 GB available and two CPU slots; do not downgrade concurrency or skip')
