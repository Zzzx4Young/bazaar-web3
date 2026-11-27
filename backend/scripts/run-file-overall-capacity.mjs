// Explicit capacity invocation: missing fixtures/services/resources are errors, never skips.
import assert from 'node:assert/strict'
import { availableParallelism } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

for (const key of [
  'PRIVATE_FILE_CAPACITY_SAMPLES',
  'PRIVATE_FILE_EXPANSION_SAMPLES',
  'PRIVATE_FILE_EVIDENCE_DIR',
  'PRIVATE_FILE_CHECK_IMAGE',
  'PRIVATE_GARAGE_ENDPOINT',
  'PRIVATE_GARAGE_BUCKET',
  'PRIVATE_GARAGE_ACCESS_KEY_ID',
  'PRIVATE_GARAGE_SECRET_KEY',
  'TEST_DATABASE_URL'
])
  assert.ok(process.env[key], `Explicit ${key} is required`)
assert.match(process.env.PRIVATE_FILE_CHECK_IMAGE, /^sha256:[a-f0-9]{64}$/)
for (const [root, name, count] of [
  [process.env.PRIVATE_FILE_CAPACITY_SAMPLES, 'manifest.json', 12],
  [process.env.PRIVATE_FILE_EXPANSION_SAMPLES, 'expansion-manifest.json', 4]
])
  assert.equal(JSON.parse(await readFile(join(root, name), 'utf8')).length, count)
const meminfo = await readFile('/proc/meminfo', 'utf8')
const hostAvailable = Number(meminfo.match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024
const max = (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim()
const current = Number((await readFile('/sys/fs/cgroup/memory.current', 'utf8')).trim())
const cgroupAvailable = max === 'max' ? hostAvailable : Number(max) - current
const admission = {
  at: new Date().toISOString(),
  hostAvailable,
  cgroupAvailable,
  availableBytes: Math.min(hostAvailable, cgroupAvailable),
  availableCpus: availableParallelism(),
  requiredAvailableBytes: 12_000_000_000,
  scannerMemoryBytes: 4_000_000_000,
  maximumScannerConcurrency: 2,
  scannerTotalBytes: 8_000_000_000
}
await writeFile(
  join(process.env.PRIVATE_FILE_EVIDENCE_DIR, 'capacity-admission.json'),
  JSON.stringify(admission, null, 2) + '\n'
)
assert.ok(admission.availableBytes >= admission.requiredAvailableBytes, '12GB available required')
assert.ok(admission.availableCpus >= 2, 'Two available CPUs required')
const child = spawn(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'tests/file-check-expansion-product.acceptance.mjs',
    'tests/file-check-capacity.integration.mjs',
    'tests/file-check-product-capacity.integration.mjs'
  ],
  { stdio: 'inherit', env: process.env }
)
child.once('error', () => {
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
