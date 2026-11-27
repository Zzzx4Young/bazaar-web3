import { readFile as fsReadFile, readlink as fsReadlink } from 'node:fs/promises'
import { availableParallelism as osParallelism } from 'node:os'
import { posix } from 'node:path'

// Linux interfaces: docs.kernel.org/admin-guide/cgroup-{v1/memory,v2}.html,
// docs.kernel.org/scheduler/sched-bwc.html and proc_pid_mountinfo(5).
// A namespace/subtree mount can hide stricter ancestors: fail closed in that case.
export async function readCapacityResources({
  readFile = fsReadFile,
  readlink = fsReadlink,
  availableParallelism = osParallelism
} = {}) {
  // Linux proc_ns.h PROC_CGROUP_INIT_INO = 0xEFFFFFFB. A private namespace
  // virtualizes '/' and can conceal stricter ancestors despite a root mount.
  // Fail closed on other kernels/layouts; never accept a caller-provided waiver.
  // https://github.com/torvalds/linux/blob/v6.12/include/linux/proc_ns.h
  let namespace
  try {
    namespace = await readlink('/proc/self/ns/cgroup')
  } catch (error) {
    throw new Error(`Cannot detect cgroup namespace: ${error.code ?? error.message}`, { cause: error })
  }
  if (namespace !== 'cgroup:[4026531835]')
    throw new Error('Capacity qualification requires the initial cgroup namespace; hidden ancestors cannot be certified')
  async function read(path, optional = false) {
    try {
      return (await readFile(path, 'utf8')).trim()
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null
      throw new Error(`Cannot detect capacity: ${path}: ${error.code ?? error.message}`, {
        cause: error
      })
    }
  }
  function invalid(path) {
    throw new Error(`Cannot detect capacity: malformed ${path}`)
  }
  function integer(value, path) {
    if (!/^\d+$/.test(value ?? '')) invalid(path)
    const result = BigInt(value)
    if (result > 18446744073709551615n) invalid(path)
    return result
  }
  function positive(value, path) {
    const result = integer(value, path)
    if (result === 0n) invalid(path)
    return result
  }
  function absolute(path, source) {
    if (!path?.startsWith('/') || posix.normalize(path) !== path) invalid(source)
    return path
  }
  const meminfo = await read('/proc/meminfo')
  const hostValue = (key) => {
    const value = meminfo.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm'))?.[1]
    const bytes = Number(positive(value, '/proc/meminfo')) * 1024
    if (!Number.isSafeInteger(bytes)) invalid('/proc/meminfo')
    return bytes
  }
  const host = {
    source: '/proc/meminfo',
    totalBytes: hostValue('MemTotal'),
    availableBytes: hostValue('MemAvailable')
  }
  const membership = (await read('/proc/self/cgroup')).split('\n').map((line) => {
    const match = line.match(/^(\d+):([^:]*):(\/.*)$/)
    if (!match) invalid('/proc/self/cgroup')
    return {
      id: match[1],
      controllers: match[2].split(','),
      path: absolute(match[3], '/proc/self/cgroup')
    }
  })
  const decode = (value) =>
    value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
  const mounts = (await read('/proc/self/mountinfo')).split('\n').flatMap((line) => {
    const [left, right] = line.split(' - ')
    const fields = right?.split(' ')
    if (!fields || !['cgroup', 'cgroup2'].includes(fields[0])) return []
    const columns = left.split(' ')
    if (!fields[2] || columns.length < 6) invalid('/proc/self/mountinfo')
    return [
      {
        version: fields[0] === 'cgroup2' ? 2 : 1,
        root: absolute(decode(columns[3]), '/proc/self/mountinfo'),
        mount: absolute(decode(columns[4]), '/proc/self/mountinfo'),
        controllers: fields[2].split(',')
      }
    ]
  })
  function hierarchy(controller) {
    const legacy = membership.find((entry) => entry.controllers.includes(controller))
    const member =
      legacy ?? membership.find((entry) => entry.id === '0' && entry.controllers[0] === '')
    const version = legacy ? 1 : 2
    const mount = mounts.find(
      (entry) =>
        entry.version === version &&
        entry.root === '/' &&
        (version === 2 || entry.controllers.includes(controller))
    )
    if (!member || !mount)
      throw new Error(
        `Cannot detect ${controller} capacity: no full hierarchy mount; ancestor limits unobservable (/proc/self/cgroup, /proc/self/mountinfo)`
      )
    return { ...mount, group: member.path, path: posix.resolve(mount.mount, '.' + member.path) }
  }
  function ancestors({ path, mount }) {
    const paths = []
    for (let current = path; ; current = posix.dirname(current)) {
      paths.push(current)
      if (current === mount) return paths
      if (current === '/') throw new Error('Cannot resolve cgroup ancestor')
    }
  }
  const memoryHierarchy = hierarchy('memory')
  const cpuHierarchy = hierarchy('cpu')
  const memory = []
  let availableBytes = Math.min(host.availableBytes, host.totalBytes)
  for (const path of ancestors(memoryHierarchy)) {
    const { version, group } = memoryHierarchy
    const root = version === 2 && path === memoryHierarchy.mount
    const limitSource = posix.join(path, version === 2 ? 'memory.max' : 'memory.limit_in_bytes')
    const usageSource = posix.join(path, version === 2 ? 'memory.current' : 'memory.usage_in_bytes')
    const rawLimit = await read(limitSource, root)
    if (rawLimit === null) {
      memory.push({
        version,
        group,
        path,
        limitSource,
        limitBytes: null,
        reason: 'v2 hierarchy root'
      })
      continue
    }
    const limit = version === 2 && rawLimit === 'max' ? null : integer(rawLimit, limitSource)
    // v1 uses PAGE_COUNTER_MAX (LONG_MAX rounded down to a page) for no limit.
    const unlimited = limit === null || (version === 1 && limit >= 9223372036854771712n)
    const rawUsage = await read(usageSource)
    const usage = integer(rawUsage, usageSource)
    const remaining = unlimited ? null : Number(limit > usage ? limit - usage : 0n)
    if (remaining !== null) availableBytes = Math.min(availableBytes, remaining)
    memory.push({
      version,
      group,
      path,
      limitSource,
      usageSource,
      rawLimit,
      rawUsage,
      limitBytes: unlimited ? null : Number(limit),
      availableBytes: remaining
    })
  }
  const parallelism = availableParallelism()
  if (!Number.isSafeInteger(parallelism) || parallelism < 1) invalid('os.availableParallelism')
  let availableCpus = parallelism
  const cpu = []
  for (const path of ancestors(cpuHierarchy)) {
    const { version, group } = cpuHierarchy
    const root = version === 2 && path === cpuHierarchy.mount
    const quotaSource = posix.join(path, version === 2 ? 'cpu.max' : 'cpu.cfs_quota_us')
    const rawQuota = await read(quotaSource, root)
    if (rawQuota === null) {
      cpu.push({ version, group, path, quotaSource, cpus: null, reason: 'v2 hierarchy root' })
      continue
    }
    let quota, period, periodSource
    if (version === 2) {
      const fields = rawQuota.split(/\s+/)
      if (fields.length !== 2) invalid(quotaSource)
      quota = fields[0] === 'max' ? null : positive(fields[0], quotaSource)
      period = positive(fields[1], quotaSource)
    } else {
      quota = rawQuota === '-1' ? null : positive(rawQuota, quotaSource)
      periodSource = posix.join(path, 'cpu.cfs_period_us')
      period = positive(await read(periodSource), periodSource)
    }
    if (
      (quota !== null && quota > BigInt(Number.MAX_SAFE_INTEGER)) ||
      period > BigInt(Number.MAX_SAFE_INTEGER)
    )
      invalid(quotaSource)
    const cpus = quota === null ? null : Number(quota) / Number(period)
    if (cpus !== null) availableCpus = Math.min(availableCpus, cpus)
    cpu.push({
      version,
      group,
      path,
      quotaSource,
      periodSource,
      rawQuota,
      periodUs: Number(period),
      cpus
    })
  }
  return {
    host,
    namespace: { source: '/proc/self/ns/cgroup', identity: namespace, initial: true },
    discoverySources: ['/proc/self/cgroup', '/proc/self/mountinfo'],
    hierarchies: { memory: memoryHierarchy, cpu: cpuHierarchy },
    parallelism: { source: 'os.availableParallelism (sched_getaffinity)', cpus: parallelism },
    memory,
    cpu,
    availableBytes,
    availableCpus
  }
}

export function assertCapacityResources({ availableBytes, availableCpus }) {
  if (
    !Number.isFinite(availableBytes) ||
    availableBytes < 12_000_000_000 ||
    !Number.isFinite(availableCpus) ||
    availableCpus < 2
  )
    throw new Error(
      'Full dual-task capacity requires 12 GB available and two CPU slots; do not downgrade concurrency or skip'
    )
}
