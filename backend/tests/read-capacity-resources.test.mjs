import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readCapacityResources,
  assertCapacityResources
} from '../scripts/read-capacity-resources.mjs'

// Fake only procfs/cgroupfs reads; all discovery, parsing and admission run in the real helper.
function fixture(version = 2, group = '/jobs/run', mountRoot = '/') {
  const files = {
    '/proc/meminfo': 'MemTotal: 31250000 kB\nMemAvailable: 19531250 kB\n',
    '/proc/self/cgroup':
      version === 2 ? `0::${group}\n` : `4:memory:${group}\n5:cpu,cpuacct:${group}\n`,
    '/proc/self/mountinfo':
      version === 2
        ? `30 1 0:1 ${mountRoot} /cg rw - cgroup2 cgroup rw\n`
        : `30 1 0:1 ${mountRoot} /mem rw - cgroup cgroup rw,memory\n31 1 0:2 ${mountRoot} /cpu rw - cgroup cgroup rw,cpu,cpuacct\n`
  }
  for (const suffix of ['', '/jobs', '/jobs/run']) {
    if (version === 2) {
      files[`/cg${suffix}/memory.max`] = 'max'
      files[`/cg${suffix}/memory.current`] = '1000000000'
      files[`/cg${suffix}/cpu.max`] = 'max 100000'
    } else {
      files[`/mem${suffix}/memory.limit_in_bytes`] = '9223372036854771712'
      files[`/mem${suffix}/memory.usage_in_bytes`] = '1000000000'
      files[`/cpu${suffix}/cpu.cfs_quota_us`] = '-1'
      files[`/cpu${suffix}/cpu.cfs_period_us`] = '100000'
    }
  }
  const detect = () =>
    readCapacityResources({
      readFile: async (path) => {
        if (!(path in files)) throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' })
        if (files[path] instanceof Error) throw files[path]
        return files[path]
      },
      readlink: async () => 'cgroup:[4026531835]',
      availableParallelism: () => 8
    })
  return { files, detect }
}

for (const version of [1, 2]) {
  test(`v${version}: unlimited remains bounded by host available memory`, async () => {
    const { detect } = fixture(version)
    const result = await detect()
    assert.equal(result.availableBytes, 20_000_000_000)
    assert.equal(result.availableCpus, 8)
    assert.equal(result.memory.length, 3)
    assert.equal(result.memory[0].version, version)
    assert.equal(result.host.source, '/proc/meminfo')
    assertCapacityResources(result)
  })
  test(`v${version}: actual nested group and occupied ancestor constrain memory and CPU`, async () => {
    const { files, detect } = fixture(version)
    files[version === 2 ? '/cg/jobs/memory.max' : '/mem/jobs/memory.limit_in_bytes'] = '16000000000'
    files[version === 2 ? '/cg/jobs/memory.current' : '/mem/jobs/memory.usage_in_bytes'] =
      '5000000000'
    if (version === 2) files['/cg/jobs/cpu.max'] = '150000 100000'
    else files['/cpu/jobs/cpu.cfs_quota_us'] = '150000'
    const result = await detect()
    assert.equal(result.availableBytes, 11_000_000_000)
    assert.equal(result.availableCpus, 1.5)
    assert.match(result.memory[0].path, /jobs\/run$/)
    assert.throws(() => assertCapacityResources(result), /12 GB.*two CPU/)
  })
  const memory = version === 2 ? '/cg/jobs/run/memory.max' : '/mem/jobs/run/memory.limit_in_bytes'
  const usage =
    version === 2 ? '/cg/jobs/run/memory.current' : '/mem/jobs/run/memory.usage_in_bytes'
  const cpu = version === 2 ? '/cg/jobs/run/cpu.max' : '/cpu/jobs/run/cpu.cfs_quota_us'
  for (const path of [
    memory,
    usage,
    cpu,
    '/proc/self/cgroup',
    '/proc/self/mountinfo',
    '/proc/meminfo'
  ]) {
    test(`v${version}: missing ${path} fails closed with source`, async () => {
      const { files, detect } = fixture(version)
      delete files[path]
      await assert.rejects(detect, (error) => error.message.includes(path))
    })
  }
  for (const [path, value] of [
    [memory, 'garbage'],
    [memory, '-2'],
    [usage, 'NaN'],
    [usage, '-1'],
    [cpu, 'bad'],
    ['/proc/meminfo', 'MemAvailable: nope kB']
  ]) {
    test(`v${version}: malformed ${path}=${value} fails closed`, async () => {
      const { files, detect } = fixture(version)
      files[path] = value
      await assert.rejects(detect, (error) => error.message.includes(path))
    })
  }
}

test('v2: genuine hierarchy root has no memory.max or cpu.max', async () => {
  const { files, detect } = fixture(2, '/')
  delete files['/cg/memory.max']
  delete files['/cg/memory.current']
  delete files['/cg/cpu.max']
  const result = await detect()
  assert.equal(result.availableBytes, 20_000_000_000)
  assert.equal(result.memory[0].reason, 'v2 hierarchy root')
})
test('missing ancestor limit fails closed', async () => {
  const { files, detect } = fixture()
  delete files['/cg/jobs/memory.max']
  await assert.rejects(detect, /\/cg\/jobs\/memory.max/)
})
test('permission error is never unlimited', async () => {
  const { files, detect } = fixture()
  files['/cg/jobs/run/memory.max'] = Object.assign(new Error('denied'), { code: 'EACCES' })
  await assert.rejects(detect, /\/cg\/jobs\/run\/memory.max.*EACCES/)
})
test('unresolvable mount and hidden ancestors fail closed', async () => {
  const { files, detect } = fixture()
  files['/proc/self/mountinfo'] = '30 1 0:1 /elsewhere /cg rw - cgroup2 cgroup rw\n'
  await assert.rejects(detect, /mount|ancestor/)
})
test('subtree mount cannot certify invisible ancestor limits', async () => {
  const { detect } = fixture(2, '/jobs/run', '/jobs')
  await assert.rejects(detect, /ancestor/)
})
test('hybrid host selects v1 controllers over unused unified hierarchy', async () => {
  const { files, detect } = fixture(1)
  files['/proc/self/cgroup'] += '0::/unified\n'
  files['/proc/self/mountinfo'] += '32 1 0:3 / /cg rw - cgroup2 cgroup rw\n'
  assert.equal((await detect()).memory[0].version, 1)
})
test('admission accepts exactly 12GB and 2 CPUs, rejects either shortfall and invalid numbers', () => {
  assertCapacityResources({ availableBytes: 12_000_000_000, availableCpus: 2 })
  for (const [availableBytes, availableCpus] of [
    [11999999999, 2],
    [12000000000, 1.99],
    [NaN, 2],
    [Infinity, 2],
    [12000000000, NaN]
  ])
    assert.throws(() => assertCapacityResources({ availableBytes, availableCpus }))
})

test('finite leaf headroom and quota constrain otherwise unlimited parents', async () => {
  const { files, detect } = fixture()
  files['/cg/jobs/run/memory.max'] = '14000000000'
  files['/cg/jobs/run/memory.current'] = '2000000000'
  files['/cg/jobs/run/cpu.max'] = '200000 100000'
  const result = await detect()
  assert.equal(result.availableBytes, 12_000_000_000)
  assert.equal(result.availableCpus, 2)
  assertCapacityResources(result)
  files['/cg/jobs/run/memory.current'] = '15000000000'
  assert.equal((await detect()).availableBytes, 0)
})
test('mountinfo escaped paths resolve to the actual cgroup mount', async () => {
  const { files, detect } = fixture()
  files['/proc/self/mountinfo'] = '30 1 0:1 / /control\\040groups rw - cgroup2 cgroup rw\n'
  for (const path of Object.keys(files))
    if (path.startsWith('/cg/')) {
      files[path.replace('/cg/', '/control groups/')] = files[path]
      delete files[path]
    }
  const result = await detect()
  assert.equal(result.memory[0].path, '/control groups/jobs/run')
})
for (const [path, value] of [
  ['/cg/jobs/run/cpu.max', 'max 0'],
  ['/cg/jobs/run/cpu.max', '200000 100000 extra'],
  ['/cg/jobs/run/memory.max', '12.5'],
  ['/proc/self/cgroup', '0::/jobs/../run'],
  ['/proc/self/mountinfo', 'malformed']
])
  test(`invalid resource metadata ${path}=${value} fails closed`, async () => {
    const { files, detect } = fixture()
    files[path] = value
    await assert.rejects(detect)
  })

test('oversized numeric kernel values are malformed, never unlimited', async () => {
  const { files, detect } = fixture()
  files['/cg/jobs/run/memory.max'] = '9'.repeat(400)
  await assert.rejects(detect, /memory.max/)
})

for (const value of ['cgroup:[4026532999]', '', 'other:[4026531835]'])
  test(`private or invalid cgroup namespace is not a host capacity certificate: ${value}`, async () => {
    await assert.rejects(readCapacityResources({
      readlink: async () => value,
      readFile: async () => { throw new Error('must reject namespace before reading capacity') }
    }), /initial cgroup namespace/)
  })
test('unreadable cgroup namespace cannot certify hidden ancestor limits', async () => {
  await assert.rejects(readCapacityResources({
    readlink: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }
  }), /cgroup namespace.*EACCES/)
})
