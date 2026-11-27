import { assertExpansionManifest } from '../scripts/file-capacity-manifest.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sandbox, fixture } from './helpers/database.mjs'
import { PrivateFileService } from '../dist/delivery-files/upload.service.js'
import { GaragePrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
import { readPrivateFileConfig } from '../dist/delivery-files/config.js'
import { observeFileCheck } from '../scripts/observe-file-check.mjs'

const root = process.env.PRIVATE_FILE_EXPANSION_SAMPLES
const evidence = process.env.PRIVATE_FILE_EVIDENCE_DIR

test(
  'R06 real queue/Garage 2GB expansion and malware never creates a version',
  { timeout: 700000 },
  async () => {
    assert.ok(
      root &&
        evidence &&
        process.env.PRIVATE_GARAGE_ENDPOINT &&
        process.env.PRIVATE_FILE_CHECK_IMAGE,
      'Explicit samples, evidence, isolated Garage and checker image required'
    )
    const db = await sandbox()
    const scratch = await mkdtemp(join(tmpdir(), 'bazaar-expansion-product-'))
    const rows = [],
      objects = [],
      cleanup = []
    let service, store
    try {
      for (const [file, value] of Object.entries({
        key: randomBytes(32).toString('hex'),
        access: process.env.PRIVATE_GARAGE_ACCESS_KEY_ID,
        secret: process.env.PRIVATE_GARAGE_SECRET_KEY
      }))
        await writeFile(join(scratch, file), value, { mode: 0o600 })
      const configPath = join(scratch, 'config.json')
      await writeFile(
        configPath,
        JSON.stringify({
          uploadOrigin: 'http://127.0.0.1:39999',
          endpoint: process.env.PRIVATE_GARAGE_ENDPOINT,
          bucket: process.env.PRIVATE_GARAGE_BUCKET,
          accessKeyIdFile: join(scratch, 'access'),
          secretAccessKeyFile: join(scratch, 'secret'),
          uploadKeyFile: join(scratch, 'key'),
          scratchRoot: join(scratch, 'jobs'),
          checker: {
            image: process.env.PRIVATE_FILE_CHECK_IMAGE,
            memoryBytes: 4_000_000_000,
            cpus: 1,
            pids: 32,
            tmpBytes: 2_200_000_000,
            wallSeconds: 120,
            sudo: true
          },
          budget: {
            globalBytes: 8_000_000_000,
            globalUploads: 8,
            checkConcurrency: 2,
            checkQueue: 4
          }
        }),
        { mode: 0o600 }
      )
      const effective = readPrivateFileConfig(
        { NODE_ENV: 'test', PRIVATE_FILE_CONFIG_FILE: configPath },
        'http://localhost:3000'
      )
      store = new GaragePrivateObjectStore(effective.store)
      service = new PrivateFileService(db.client, store, effective.budget, effective.uploadKey)
      const f = await fixture(db, 'digital')
      const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
      await db.client.order.update({
        where: { id: orderId },
        data: { settlementMode: 'testnet_escrow' }
      })
      const manifest = JSON.parse(await readFile(join(root, 'expansion-manifest.json'), 'utf8'))
    assertExpansionManifest(manifest)
      assert.equal(manifest.length, 4)
      for (const sample of manifest) {
        const input = {
          purpose: 'delivery',
          filename: 'source.zip',
          contentType: 'application/zip',
          byteSize: sample.bytes
        }
        const token = await service.createUpload(f.seller, orderId, input, randomUUID())
        await service.receive(
          token.uploadId,
          token.uploadToken,
          createReadStream(join(root, sample.name)),
          input.contentType
        )
        await service.completeUpload(f.seller, token.uploadId)
        const upload = await db.client.privateUpload.findUniqueOrThrow({
          where: { id: token.uploadId }
        })
        objects.push(upload.objectKey)
        const checker = new DockerFileChecker(effective.checker)
        const check = checker.check.bind(checker)
        let observe
        checker.check = async (path, mime, id, options) => {
          observe = observeFileCheck(id, 2000)
          return check(path, mime, id, options)
        }
        const started = Date.now()
        let result, observation
        try {
          result = await service.checkNext(checker, effective.scratchRoot)
        } finally {
          observation = observe ? await observe() : null
        }
        const checks = await db.client.privateFileCheck.findMany({
          where: { uploadId: token.uploadId },
          select: { report: true }
        })
        const versions = await db.client.privateFileVersion.findMany({
          where: { uploadId: token.uploadId },
          select: { byteSize: true, sha256: true }
        })
        rows.push({
          sample,
          uploadId: token.uploadId,
          result,
          checks,
          versions,
          observation,
          wallMs: Date.now() - started
        })
        assert.equal(
          result?.status,
          sample.expected === 'clean' ? 'ready' : 'rejected',
          JSON.stringify({ sample, result, checks })
        )
        assert.equal(observation?.removed, true)
        assert.equal(versions.length, sample.expected === 'clean' ? 1 : 0)
        if (sample.expected === 'clean') {
          assert.equal(checks[0].report.malware.scope, 'whole-container-recursive')
          assert.equal(checks[0].report.malware.members.entries, 4)
          assert.equal(checks[0].report.malware.members.expandedBytes, sample.expandedBytes)
          assert.match(checks[0].report.malware.members.sha256, /^[a-f0-9]{64}$/)
          assert.equal(versions[0].byteSize, sample.bytes)
          assert.equal(versions[0].sha256, sample.sha256)
        } else {
          assert.equal(checks[0].report.reason, sample.reason ?? 'ZIP_SIZE')
          await service.cleanupUpload(token.uploadId)
        }
        assert.deepEqual(await readdir(effective.scratchRoot), [])
      }
    } finally {
      for (const key of objects) {
        try {
          await store.deleteAndConfirm(key)
          cleanup.push({ key, deleted: true })
        } catch {
          cleanup.push({ key, deleted: false })
        }
      }
      await writeFile(
        join(evidence, 'expansion-product.json'),
        JSON.stringify({ rows, cleanup }, null, 2) + '\n'
      )
      await db.close()
      await rm(scratch, { recursive: true, force: true })
      assert.ok(cleanup.every((x) => x.deleted))
    }
  }
)
