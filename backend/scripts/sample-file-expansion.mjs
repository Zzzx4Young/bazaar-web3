import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
import { observeFileCheck } from './observe-file-check.mjs'
const root = resolve(process.argv[2]),
  manifest = JSON.parse(await readFile(join(root, 'expansion-manifest.json'), 'utf8'))
const runtime = {
  image: process.env.PRIVATE_FILE_CHECK_IMAGE,
  memoryBytes: 4_000_000_000,
  cpus: 1,
  pids: 32,
  tmpBytes: 2_200_000_000,
  wallSeconds: 120,
  sudo: true
}
const rows = []
for (const sample of manifest) {
  const id = randomUUID(),
    finish = observeFileCheck(id),
    start = Date.now()
  const report = await new DockerFileChecker(runtime).check(
    join(root, sample.name),
    'application/zip',
    id
  )
  rows.push({ sample, report, elapsedMs: Date.now() - start, observation: await finish() })
  await writeFile(
    join(process.env.PRIVATE_FILE_EVIDENCE_DIR ?? root, 'expansion-results.json'),
    JSON.stringify({ runtime, rows }, null, 2) + '\n'
  )
  console.log(sample.name, report.status, report.reason)
}
for (const row of rows) {
  assert.equal(row.report.status, row.sample.expected)
  assert.equal(row.observation.removed, true)
}
