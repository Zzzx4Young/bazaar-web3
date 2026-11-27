import { assertExpansionManifest } from '../scripts/file-capacity-manifest.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
import { observeFileCheck } from '../scripts/observe-file-check.mjs'

const root = process.env.PRIVATE_FILE_EXPANSION_SAMPLES
const evidence = process.env.PRIVATE_FILE_EVIDENCE_DIR
const runtime = {
  image: process.env.PRIVATE_FILE_CHECK_IMAGE,
  memoryBytes: 4_000_000_000,
  cpus: 1,
  pids: 32,
  tmpBytes: 2_200_000_000,
  wallSeconds: 120,
  sudo: true
}
// Explicit invocation is fail-closed. This suite must not silently skip missing resources.
test(
  'R06 actual 2GB expansion boundaries and late-member malware scan',
  { timeout: 700000 },
  async () => {
    assert.ok(
      root && evidence && runtime.image,
      'Explicit expansion samples, evidence and checker image required'
    )
    const manifest = JSON.parse(await readFile(join(root, 'expansion-manifest.json'), 'utf8'))
    assertExpansionManifest(manifest)
    const rows = []
    for (const sample of manifest) {
      const path = join(root, sample.name)
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      assert.equal(hash.digest('hex'), sample.sha256)
      const id = randomUUID()
      const finish = observeFileCheck(id, 2000)
      const started = Date.now()
      let report
      try {
        report = await new DockerFileChecker(runtime).check(path, 'application/zip', id)
      } finally {
        const observation = await finish()
        rows.push({ sample, id, report, runtime, wallMs: Date.now() - started, observation })
        await writeFile(
          join(evidence, 'expansion-runtime.json'),
          JSON.stringify(rows, null, 2) + '\n'
        )
      }
      assert.equal(rows.at(-1).observation.removed, true)
      assert.equal(report.status, sample.expected, JSON.stringify(report))
      if (sample.expected === 'clean') {
        assert.equal(report.bytes, sample.bytes)
        assert.equal(report.sha256, sample.sha256)
        assert.equal(report.structural, true)
        assert.equal(report.malware.clean, true)
        assert.equal(report.malware.scope, 'whole-container-recursive')
        assert.equal(report.malware.members.entries, 4)
        assert.equal(report.malware.members.expandedBytes, sample.expandedBytes)
      } else {
        assert.equal(report.reason, sample.reason ?? 'ZIP_SIZE')
      }
    }
  }
)
