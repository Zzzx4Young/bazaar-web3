// Bounded local real-object scanner. No API, DB, signing, upload or download claims.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
import { observeFileCheck } from './observe-file-check.mjs'

export async function sampleFileCapacity(root, image) {
  assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/)
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.length, 12)
  const runtime = {
    image,
    memoryBytes: 4_000_000_000,
    cpus: 1,
    pids: 32,
    tmpBytes: 2_200_000_000,
    wallSeconds: 120,
    sudo: true
  }
  const evidence = process.env.PRIVATE_FILE_EVIDENCE_DIR ?? join(root, '..')
  const rows = []
  const started = Date.now()
  async function scan(sample, concurrency) {
    assert.equal(sample.name, sample.name.split('/').pop())
    const path = join(root, sample.name)
    const info = await stat(path)
    assert.equal(info.size, sample.bytes)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    assert.equal(hash.digest('hex'), sample.sha256)
    const id = randomUUID(),
      begin = Date.now(),
      finish = observeFileCheck(id, 2000)
    let report, exception
    try {
      report = await new DockerFileChecker(runtime).check(path, sample.mime, id)
    } catch (error) {
      exception = error.message
    }
    const observation = await finish()
    const row = {
      sample,
      id,
      concurrency,
      wallMs: Date.now() - begin,
      runtime,
      report,
      exception,
      observation,
      scanScope: exception
        ? 'host actual-file size refusal; no container scan'
        : report?.status === 'clean'
          ? 'full structural parse, ClamAV and SHA256 of actual local object'
          : 'actual local object supplied; rejected before complete clean scan',
      unavailable: [
        'host CPU/memory/temp peak',
        'API/queue/DB/object-storage/signing/download timings'
      ],
      temporaryInputBytes: info.size
    }
    if (report?.status === 'clean') {
      assert.equal(report.bytes, sample.bytes)
      assert.equal(report.sha256, sample.sha256)
      assert.equal(report.structural, true)
      assert.equal(report.malware?.engine, 'ClamAV')
    }
    rows.push(row)
    await writeFile(join(evidence, `capacity-${id}.json`), JSON.stringify(row, null, 2) + '\n', {
      mode: 0o600
    })
    console.log(
      sample.name,
      `concurrency=${concurrency}`,
      row.wallMs,
      report?.status ?? 'refused',
      report?.reason ?? exception
    )
    return row
  }
  for (const sample of manifest) await scan(sample, 1)
  // Explicit bounded concurrency observation; not a service capacity promise.
  const zip = manifest.find((s) => s.kind === 'zip' && s.delta === 0)
  const pair = [zip, zip]
  await Promise.all(pair.map((s) => scan(s, 2)))
  const result = {
    started: new Date(started).toISOString(),
    wallMs: Date.now() - started,
    totalUniqueInputBytes: manifest.reduce((n, s) => n + s.bytes, 0),
    totalScannedOrAttemptedBytes: rows.reduce((n, r) => n + r.sample.bytes, 0),
    maximumCheckerConcurrency: 2,
    runtime,
    rows
  }
  await writeFile(join(evidence, 'capacity-summary.json'), JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600
  })
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await sampleFileCapacity(resolve(process.argv[2]), process.env.PRIVATE_FILE_CHECK_IMAGE)
}
