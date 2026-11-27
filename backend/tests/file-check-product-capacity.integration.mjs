import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readCapacityResources,
  assertCapacityResources
} from '../scripts/read-capacity-resources.mjs'
import { execFileSync } from 'node:child_process'
import { sandbox, fixture } from './helpers/database.mjs'
import { PrivateFileService } from '../dist/delivery-files/upload.service.js'
import { GaragePrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
import { readPrivateFileConfig } from '../dist/delivery-files/config.js'
import { observeFileCheck } from '../scripts/observe-file-check.mjs'
const root = process.env.PRIVATE_FILE_CAPACITY_SAMPLES
const enabled = Boolean(
  root && process.env.PRIVATE_GARAGE_ENDPOINT && process.env.PRIVATE_FILE_CHECK_IMAGE
)
const base = {
  image: process.env.PRIVATE_FILE_CHECK_IMAGE,
  memoryBytes: 4_000_000_000,
  cpus: 1,
  pids: 32,
  tmpBytes: 2_200_000_000,
  wallSeconds: 120,
  sudo: true
}
const budget = { globalBytes: 8_000_000_000, globalUploads: 8, checkConcurrency: 2, checkQueue: 4 }
function docker(args) {
  return execFileSync('sudo', ['-n', 'docker', ...args], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}
test(
  'R06 normal product config, actual queue and Garage bytes: ZIP boundaries, two 500MB jobs and controlled failures',
  { skip: !enabled, timeout: 1_500_000 },
  async () => {
    const db = await sandbox(),
      f = await fixture(db, 'digital'),
      scratch = await mkdtemp(join(tmpdir(), 'bazaar-r06-product-'))
    let memoryAdmission
    const objects = [],
      rows = [],
      configPath = join(scratch, 'config.json')
    const storeConfig = {
      endpoint: process.env.PRIVATE_GARAGE_ENDPOINT,
      bucket: process.env.PRIVATE_GARAGE_BUCKET,
      accessKeyId: process.env.PRIVATE_GARAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.PRIVATE_GARAGE_SECRET_KEY
    }
    for (const [file, value] of Object.entries({
      key: randomBytes(32).toString('hex'),
      access: storeConfig.accessKeyId,
      secret: storeConfig.secretAccessKey
    }))
      await writeFile(join(scratch, file), value, { mode: 0o600 })
    await writeFile(
      configPath,
      JSON.stringify({
        uploadOrigin: 'http://127.0.0.1:39999',
        ...storeConfig,
        accessKeyIdFile: join(scratch, 'access'),
        secretAccessKeyFile: join(scratch, 'secret'),
        uploadKeyFile: join(scratch, 'key'),
        checker: base,
        budget,
        scratchRoot: join(scratch, 'jobs')
      }),
      { mode: 0o600 }
    )
    const effective = readPrivateFileConfig(
      { NODE_ENV: 'test', PRIVATE_FILE_CONFIG_FILE: configPath },
      'http://localhost:3000'
    )
    const store = new GaragePrivateObjectStore(effective.store),
      service = new PrivateFileService(db.client, store, effective.budget, effective.uploadKey)
    const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
    await db.client.order.update({
      where: { id: orderId },
      data: { settlementMode: 'testnet_escrow' }
    })
    async function upload(name, size) {
      const input = {
        purpose: 'delivery',
        filename: 'source.zip',
        contentType: 'application/zip',
        byteSize: size
      }
      const token = await service.createUpload(f.seller, orderId, input, randomUUID())
      await service.receive(
        token.uploadId,
        token.uploadToken,
        createReadStream(join(root, name)),
        input.contentType
      )
      await service.completeUpload(f.seller, token.uploadId)
      const row = await db.client.privateUpload.findUniqueOrThrow({ where: { id: token.uploadId } })
      objects.push(row.objectKey)
      return row
    }
    async function scan(checker = new DockerFileChecker(effective.checker), hook) {
      const finish = [],
        check = checker.check.bind(checker)
      checker.check = async (path, mime, id, options) => {
        const observe = observeFileCheck(id, 2000)
        finish.push(observe)
        if (hook) void hook(id)
        return check(path, mime, id, options)
      }
      const start = Date.now()
      let result, exception
      try {
        result = await service.checkNext(checker, effective.scratchRoot)
      } catch (e) {
        exception = e.code ?? e.message
      }
      const observations = await Promise.all(finish.map((x) => x()))
      const record = { result, exception, elapsedMs: Date.now() - start, observations }
      rows.push(record)
      return record
    }
    try {
      const first = await upload('zip-499999999.zip', 499999999),
        a = await scan()
      assert.equal(a.result?.status, 'ready', JSON.stringify(a))
      assert.equal(
        (await db.client.privateFileVersion.findUniqueOrThrow({ where: { uploadId: first.id } }))
          .byteSize,
        499999999
      )
      const pair = await Promise.all([
        upload('zip-500000000.zip', 500000000),
        upload('zip-500000000.zip', 500000000)
      ])
      // Both live cgroups must fit together, including a host/service reserve.
      const resources = await readCapacityResources()
      memoryAdmission = {
        hostAvailable: resources.host.availableBytes,
        cgroupAvailable: Math.min(
          resources.host.availableBytes,
          ...resources.memory.map((row) => row.availableBytes ?? resources.host.availableBytes)
        ),
        available: resources.availableBytes,
        scannerTotalBytes: base.memoryBytes * 2,
        requiredAvailableBytes: 12_000_000_000,
        availableCpus: resources.availableCpus,
        resources
      }
      assertCapacityResources(resources)
      const tasks = [scan(), scan()]
      for (
        let n = 0;
        n < 200 && (await db.client.privateFileGlobal.findFirstOrThrow()).checking !== 2;
        n++
      )
        await new Promise((r) => setTimeout(r, 20))
      assert.equal((await db.client.privateFileGlobal.findFirstOrThrow()).checking, 2)
      assert.equal(
        await service.checkNext(new DockerFileChecker(base), effective.scratchRoot),
        null
      )
      const pairResults = await Promise.all(tasks)
      assert.deepEqual(
        pairResults.map((x) => x.result?.status),
        ['ready', 'ready']
      )
      const pairChecks = await db.client.privateFileCheck.findMany({
        where: { uploadId: { in: pair.map((item) => item.id) } },
        select: { report: true }
      })
      assert.equal(pairChecks.length, 2)
      assert.equal(
        pairChecks.reduce((sum, item) => sum + item.report.resource.memoryBytes, 0),
        8_000_000_000,
        'Actual two-task cgroup memory budgets must total 8GB'
      )
      assert.equal((await db.client.privateFileGlobal.findFirstOrThrow()).checking, 0)
      for (const item of pair)
        assert.equal(
          (await db.client.privateFileVersion.findUniqueOrThrow({ where: { uploadId: item.id } }))
            .byteSize,
          500000000
        )
      await assert.rejects(
        service.createUpload(
          f.seller,
          orderId,
          {
            purpose: 'delivery',
            filename: 'source.zip',
            contentType: 'application/zip',
            byteSize: 500000001
          },
          randomUUID()
        ),
        /INVALID_INPUT/
      )
      const full = await upload('zip-500000000.zip', 500000000),
        refused = await scan(new DockerFileChecker({ ...base, tmpBytes: 64_000_000 }))
      assert.equal(refused.result?.status, 'rejected')
      assert.equal(await db.client.privateFileVersion.count({ where: { uploadId: full.id } }), 0)
      await service.cleanupUpload(full.id)
      const timed = await upload('zip-500000000.zip', 500000000),
        timeout = await scan(new DockerFileChecker({ ...base, wallSeconds: 1 }))
      assert.equal(timeout.result?.status, 'check_timeout')
      assert.equal(await db.client.privateFileVersion.count({ where: { uploadId: timed.id } }), 0)
      await service.cleanupUpload(timed.id)
      // Real scanner task; external kill and failed removal must fail closed.
      const killed = await upload('zip-500000000.zip', 500000000)
      const kill = async (id) => {
        for (let n = 0; n < 200; n++) {
          try {
            const state = JSON.parse(docker(['inspect', 'bazaar-private-check-' + id]))[0]
            if (state.State.Running) {
              docker(['kill', '--signal=KILL', 'bazaar-private-check-' + id])
              return
            }
          } catch {
            /* not yet created */
          }
          await new Promise((r) => setTimeout(r, 25))
        }
        throw Error('OWNED_CHECKER_NOT_OBSERVED')
      }
      const stopped = await scan(new DockerFileChecker(base), kill)
      assert.equal(stopped.result?.status, 'rejected')
      assert.equal(await db.client.privateFileVersion.count({ where: { uploadId: killed.id } }), 0)
      await service.cleanupUpload(killed.id)
      const blocked = await upload('zip-500000000.zip', 500000000),
        badCleanup = new DockerFileChecker({ ...base, wallSeconds: 1 })
      badCleanup.terminate = async () => false
      const bad = await scan(badCleanup)
      assert.equal(bad.exception, 'FILE_UNAVAILABLE')
      const pending = await db.client.privateUpload.findUniqueOrThrow({ where: { id: blocked.id } })
      assert.equal(pending.status, 'checking')
      assert.equal(await db.client.privateFileVersion.count({ where: { uploadId: blocked.id } }), 0)
      assert.equal((await db.client.privateFileGlobal.findFirstOrThrow()).checking, 1)
      assert.equal(await new DockerFileChecker(base).terminate(pending.checkId), true)
      await db.client.privateUpload.update({
        where: { id: blocked.id },
        data: { checkDeadlineAt: new Date(0) }
      })
      await service.reapChecks(new DockerFileChecker(base), effective.scratchRoot)
      assert.equal((await db.client.privateFileGlobal.findFirstOrThrow()).checking, 0)
      assert.equal(await db.client.privateFileVersion.count({ where: { uploadId: blocked.id } }), 0)
      await service.cleanupUpload(blocked.id)
      assert.deepEqual(await readdir(effective.scratchRoot), [])
    } finally {
      const checks = await db.client.privateFileCheck.findMany({
        select: { uploadId: true, report: true }
      })
      const cleanup = []
      for (const key of objects) {
        try {
          await store.deleteAndConfirm(key)
          cleanup.push({ key, deleted: true })
        } catch {
          cleanup.push({ key, deleted: false })
        }
      }
      if (process.env.PRIVATE_FILE_EVIDENCE_DIR)
        await writeFile(
          join(process.env.PRIVATE_FILE_EVIDENCE_DIR, 'product-capacity.json'),
          JSON.stringify(
            {
              effective: { checker: effective.checker, budget: effective.budget },
              orderId,
              memoryAdmission,
              rows,
              checks,
              cleanup,
              limits:
                'sampled peak may miss transient values; synthetic samples, local Garage, two containers share host'
            },
            null,
            2
          ) + '\n'
        )
      await db.close()
      await rm(scratch, { recursive: true, force: true })
      assert.ok(cleanup.every((x) => x.deleted))
    }
  }
)
