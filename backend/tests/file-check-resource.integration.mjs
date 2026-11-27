import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observeFileCheck } from '../scripts/observe-file-check.mjs'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
const image = process.env.PRIVATE_FILE_CHECK_IMAGE,
  control = process.env.PRIVATE_FILE_CONTROL_IMAGE
function docker(args) {
  return execFileSync('sudo', ['-n', 'docker', ...args], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}
const runtime = {
  image,
  memoryBytes: 4_000_000_000,
  cpus: 1,
  pids: 32,
  tmpBytes: 2_200_000_000,
  wallSeconds: 120,
  sudo: true
}
function pdf(active = false) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R' + (active ? ' /OpenAction 5 0 R' : '') + ' >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    ...(active ? ['<< /S /JavaScript /#4A#53 (app.alert) >>'] : [])
  ]
  let text = '%PDF-1.7\n',
    offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(text))
    text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  text += offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
    .join('')
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}
async function check(bytes, type, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bazaar-real-check-')),
    file = join(dir, 'object')
  try {
    await writeFile(file, bytes, { mode: 0o444 })
    const started = Date.now(),
      id = randomUUID()
    const finishObservation = observeFileCheck(id)
    let report, observation
    try {
      report = await new DockerFileChecker({ ...runtime, ...options }).check(file, type, id)
    } finally {
      observation = await finishObservation()
    }
    if (process.env.PRIVATE_FILE_EVIDENCE_DIR) {
      await writeFile(
        join(process.env.PRIVATE_FILE_EVIDENCE_DIR, 'resource-' + randomUUID() + '.json'),
        JSON.stringify(
          {
            requestedType: type,
            id,
            observation,
            inputBytes: bytes.length,
            elapsedMs: Date.now() - started,
            runtime: { ...runtime, ...options },
            report
          },
          null,
          2
        ) + '\n',
        { mode: 0o600 }
      )
    }
    assert.equal(observation.removed, true)
    if (options.image === control && bytes.toString() === 'sleep')
      assert.ok(
        observation.samples.some((s) => s.pid1Children),
        'live spawned child must be observed before timeout'
      )
    return report
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
for (const format of ['PNG', 'JPEG'])
  test(`T05 real isolated decoder and ClamAV accept ${format}`, { skip: !image }, async () => {
    const script = `from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGB',(2,2),(50,100,150)).save(b,format='${format}');print(base64.b64encode(b.getvalue()).decode())`
    const bytes = Buffer.from(
      docker([
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'python3',
        image,
        '-c',
        script
      ]).trim(),
      'base64'
    )
    const r = await check(bytes, format === 'PNG' ? 'image/png' : 'image/jpeg')
    assert.equal(r.status, 'clean', JSON.stringify(r))
    assert.equal(r.malware.engine, 'ClamAV')
    assert.equal(r.resource.network, 'none')
    assert.equal(r.resource.readOnly, true)
    const corrupt = await check(
      Buffer.concat([bytes, Buffer.from('extra')]),
      format === 'PNG' ? 'image/png' : 'image/jpeg'
    )
    assert.equal(corrupt.status, 'rejected')
    assert.equal(corrupt.processStopped, true)
  })
test(
  'T05 real PDF parser rejects encoded active content and accepts plain PDF',
  { skip: !image },
  async () => {
    const plain = await check(pdf(), 'application/pdf')
    assert.equal(plain.status, 'clean', JSON.stringify(plain))
    const active = await check(pdf(true), 'application/pdf')
    assert.equal(active.status, 'rejected')
    assert.equal(active.reason, 'PDF_ACTIVE_CONTENT')
  }
)
test(
  'T05 real ClamAV scans inside ZIP and detects its standard harmless antivirus fixture',
  { skip: !image },
  async () => {
    const script = `import io,zipfile,base64\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('av-test.txt',b'X5O!P%@AP[4\\\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')\nprint(base64.b64encode(b.getvalue()).decode())`
    const bytes = Buffer.from(
      execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim(),
      'base64'
    )
    const r = await check(bytes, 'application/zip')
    assert.equal(r.status, 'rejected', JSON.stringify(r))
    assert.equal(r.reason, 'MALWARE_DETECTED')
    assert.equal(r.processStopped, true)
  }
)
test(
  'T05 real runtime kills timed-out worker and child container process tree',
  { skip: !control },
  async () => {
    const start = Date.now(),
      r = await check(Buffer.from('sleep'), 'application/zip', {
        image: control,
        wallSeconds: 2,
        memoryBytes: 128_000_000
      })
    assert.equal(r.status, 'timeout', JSON.stringify(r))
    assert.equal(r.processStopped, true)
    assert.ok(Date.now() - start < 15000)
    assert.equal(r.resource.network, 'none')
    assert.equal(r.resource.memoryBytes, 128_000_000)
  }
)
test(
  'T05 real cgroup memory limit rejects resource exhaustion without a clean verdict',
  { skip: !control },
  async () => {
    const r = await check(Buffer.from('memory'), 'application/zip', {
      image: control,
      wallSeconds: 10,
      memoryBytes: 128_000_000
    })
    assert.equal(r.status, 'rejected', JSON.stringify(r))
    assert.equal(r.resource.oomKilled, true)
    assert.equal(r.processStopped, true)
  }
)
