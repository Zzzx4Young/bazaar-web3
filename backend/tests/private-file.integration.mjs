import test from 'node:test'
import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { sandbox, fixture, deferred } from './helpers/database.mjs'
import { PrivateFileService } from '../dist/delivery-files/upload.service.js'
import { LocalPrivateObjectStore } from '../dist/delivery-files/object-store.js'

async function setup(policy = {}) {
  const db = await sandbox(),
    f = await fixture(db, 'digital'),
    root = await mkdtemp(join(tmpdir(), 'bazaar-private-test-'))
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  await db.client.order.update({
    where: { id: orderId },
    data: { settlementMode: 'testnet_escrow' }
  })
  const store = new LocalPrivateObjectStore(root)
  let clock = Date.now()
  const service = new PrivateFileService(
    db.client,
    store,
    { globalBytes: 8_000_000_000, globalUploads: 8, checkConcurrency: 1, checkQueue: 4, ...policy },
    Buffer.alloc(32, 7),
    () => new Date(clock)
  )
  return {
    db,
    f,
    root,
    orderId,
    store,
    service,
    advance: (ms) => {
      clock += ms
    },
    close: async () => {
      await db.close()
      await rm(root, { recursive: true, force: true })
    },
    create: (key = randomUUID(), extra = {}) =>
      service.createUpload(
        f.seller,
        orderId,
        {
          purpose: 'delivery',
          filename: 'source.zip',
          contentType: 'application/zip',
          byteSize: 100,
          ...extra
        },
        key
      )
  }
}

test('T05/A23: concurrent quota reservations and idempotent intent retries retain original expiry', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      [a, b] = await Promise.all([t.create(key), t.create(key)])
    assert.deepEqual(a, b)
    await t.create()
    await assert.rejects(t.create(), /FILE_LIMIT_REACHED/)
    assert.equal(await t.db.client.privateUpload.count(), 2)
    assert.equal(
      (await t.db.client.privateFileQuota.findUniqueOrThrow({ where: { accountId: t.f.seller } }))
        .reservedBytes,
      200n
    )
  } finally {
    await t.close()
  }
})

test('T05/A23: streaming upload rejects excess bytes and releases reserved capacity only after deletion', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    await assert.rejects(
      t.service.receive(
        a.uploadId,
        a.uploadToken,
        Readable.from([Buffer.alloc(101)]),
        'application/zip'
      ),
      /INVALID_INPUT/
    )
    assert.equal(
      (await t.db.client.privateUpload.findUniqueOrThrow({ where: { id: a.uploadId } })).status,
      'cleanup_pending'
    )
    assert.equal(
      (await t.db.client.privateFileQuota.findUniqueOrThrow({ where: { accountId: t.f.seller } }))
        .reservedBytes,
      100n
    )
    await t.service.cleanupUpload(a.uploadId)
    assert.equal(
      (await t.db.client.privateFileQuota.findUniqueOrThrow({ where: { accountId: t.f.seller } }))
        .reservedBytes,
      0n
    )
  } finally {
    await t.close()
  }
})

test('T05/A23: failed-object cleanup errors retain quota; repeated confirmed cleanup releases once', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    await assert.rejects(
      t.service.receive(
        a.uploadId,
        a.uploadToken,
        Readable.from([Buffer.alloc(101)]),
        'application/zip'
      )
    )
    const remove = t.store.deleteAndConfirm.bind(t.store)
    t.store.deleteAndConfirm = async () => {
      throw new Error('delete unavailable')
    }
    await assert.rejects(t.service.cleanupUpload(a.uploadId), /delete unavailable/)
    assert.equal((await t.db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 100n)
    t.store.deleteAndConfirm = remove
    await t.service.cleanupUpload(a.uploadId)
    await t.service.cleanupUpload(a.uploadId)
    assert.equal((await t.db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 0n)
  } finally {
    await t.close()
  }
})

test('T05/A23: shared account and global byte limits reject reservations before upload', async () => {
  const t = await setup()
  try {
    await t.create('initial')
    await t.db.client.privateFileQuota.update({
      where: { accountId: t.f.seller },
      data: { usedBytes: 1999999850n }
    })
    await assert.rejects(t.create(), /FILE_LIMIT_REACHED/)
    assert.equal(await t.db.client.privateUpload.count(), 1)
    await t.db.client.privateFileQuota.update({
      where: { accountId: t.f.seller },
      data: { usedBytes: 0 }
    })
    await t.db.client.privateFileGlobal.update({
      where: { singleton: true },
      data: { usedBytes: 7999999750n }
    })
    const results = await Promise.allSettled([
      t.create(),
      t.service.createUpload(
        t.f.buyer,
        t.orderId,
        {
          purpose: 'evidence',
          filename: 'proof.zip',
          contentType: 'application/zip',
          byteSize: 100
        },
        'global-proof'
      )
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  } finally {
    await t.close()
  }
})

test('T05/A23: rolling ten-intent limit survives failures and idempotent retries do not count again', async () => {
  const t = await setup()
  try {
    let first
    for (let i = 0; i < 10; i++) {
      const a = await t.create('hour-' + i)
      if (i === 0) first = a
      await assert.rejects(
        t.service.receive(
          a.uploadId,
          a.uploadToken,
          Readable.from([Buffer.alloc(101)]),
          'application/zip'
        )
      )
      await t.service.cleanupUpload(a.uploadId)
    }
    await assert.rejects(t.create(), /FILE_LIMIT_REACHED/)
    assert.equal((await t.create('hour-0')).uploadId, first.uploadId)
    assert.equal(await t.db.client.privateUpload.count(), 10)
  } finally {
    await t.close()
  }
})

test('T05/A23: completing after the original 24-hour deadline cannot revive or refill a cleaned upload', async () => {
  const t = await setup(),
    entered = deferred(),
    release = deferred()
  try {
    const a = await t.create(),
      put = t.store.putOnce.bind(t.store)
    t.store.putOnce = (key, source, bytes, type, commit, gate) =>
      put(
        key,
        source,
        bytes,
        type,
        async (receipt, finish) => {
          entered.resolve()
          await release.promise
          return commit(receipt, finish)
        },
        gate
      )
    const receiving = t.service.receive(
      a.uploadId,
      a.uploadToken,
      Readable.from([Buffer.alloc(100)]),
      'application/zip'
    )
    const rejected = assert.rejects(receiving, /STATE_CONFLICT/)
    await entered.promise
    t.advance(86400_000)
    assert.deepEqual(await t.service.expireUploads(), [a.uploadId])
    await assert.rejects(t.service.cleanupUpload(a.uploadId), /STATE_CONFLICT/)
    release.resolve()
    await rejected
    await t.service.cleanupUpload(a.uploadId)
    assert.equal(
      (await t.db.client.privateUpload.findUniqueOrThrow({ where: { id: a.uploadId } })).status,
      'cleaned'
    )
    assert.equal((await t.db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 0n)
  } finally {
    release.resolve()
    await t.close()
  }
})

test('T05/A17/A25: checked bytes create one immutable unpublished version; queue/concurrency and purpose remain isolated', async () => {
  const t = await setup({ checkQueue: 1 }),
    entered = deferred(),
    release = deferred()
  try {
    const a = await t.create(),
      b = await t.create()
    for (const u of [a, b])
      await t.service.receive(
        u.uploadId,
        u.uploadToken,
        Readable.from([Buffer.alloc(100)]),
        'application/zip'
      )
    await t.service.completeUpload(t.f.seller, a.uploadId)
    await assert.rejects(t.service.completeUpload(t.f.seller, b.uploadId), /FILE_LIMIT_REACHED/)
    const row = await t.db.client.privateUpload.findUniqueOrThrow({ where: { id: a.uploadId } })
    const checker = {
      async check() {
        entered.resolve()
        await release.promise
        return {
          status: 'clean',
          reason: 'CHECKS_PASSED',
          processStopped: true,
          bytes: 100,
          sha256: row.sha256,
          contentType: 'application/zip',
          structural: true,
          malware: {
            clean: true,
            engine: 'ClamAV',
            version: 'substitute-only',
            signatureDate: '2026-11-08'
          }
        }
      },
      async terminate() {
        return true
      }
    }
    const checking = t.service.checkNext(checker, t.root + '/scratch')
    await entered.promise
    await t.service.completeUpload(t.f.seller, b.uploadId)
    assert.equal(await t.service.checkNext(checker, t.root + '/scratch'), null)
    release.resolve()
    assert.equal((await checking).status, 'ready')
    assert.equal(await t.db.client.privateFileVersion.count(), 1)
    assert.equal((await t.service.status(t.f.seller, a.uploadId)).downloadEnabled, false)
    await assert.rejects(t.service.cleanupUpload(a.uploadId), /STATE_CONFLICT/)
    const q = await t.db.client.privateFileQuota.findFirstOrThrow()
    assert.equal(q.usedBytes, 100n)
    assert.equal(q.reservedBytes, 100n)
    await assert.rejects(
      t.service.createUpload(
        t.f.buyer,
        t.orderId,
        { purpose: 'delivery', filename: 'x.zip', contentType: 'application/zip', byteSize: 100 },
        'wrong-purpose'
      ),
      /FORBIDDEN/
    )
  } finally {
    release.resolve()
    await t.close()
  }
})

test('T05/A25: uncertain worker termination holds its slot until explicit stopped-process recovery', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    await t.service.receive(
      a.uploadId,
      a.uploadToken,
      Readable.from([Buffer.alloc(100)]),
      'application/zip'
    )
    await t.service.completeUpload(t.f.seller, a.uploadId)
    const checker = {
      async check() {
        throw new Error('lost supervisor')
      },
      async terminate() {
        return false
      }
    }
    await assert.rejects(t.service.checkNext(checker, t.root + '/scratch'), /FILE_UNAVAILABLE/)
    assert.equal((await t.db.client.privateFileGlobal.findFirstOrThrow()).checking, 1)
    t.advance(150000)
    await assert.rejects(t.service.reapChecks(checker, t.root + '/scratch'), /FILE_UNAVAILABLE/)
    checker.terminate = async () => true
    await t.service.reapChecks(checker, t.root + '/scratch')
    assert.equal((await t.db.client.privateFileGlobal.findFirstOrThrow()).checking, 0)
    assert.equal(
      (await t.db.client.privateUpload.findUniqueOrThrow({ where: { id: a.uploadId } })).status,
      'check_timeout'
    )
  } finally {
    await t.close()
  }
})

test('T05/A23: file-type and decimal byte limits are enforced without allocating payloads', async () => {
  const t = await setup()
  try {
    for (const extra of [
      { filename: 'x.pdf', contentType: 'application/pdf', byteSize: 20000001 },
      { filename: 'x.zip', contentType: 'application/zip', byteSize: 500000001 },
      { filename: 'x.jpg', contentType: 'application/zip' },
      { filename: '../x.zip' }
    ])
      await assert.rejects(t.create(randomUUID(), extra), /INVALID_INPUT/)
    assert.equal(await t.db.client.privateUpload.count(), 0)
  } finally {
    await t.close()
  }
})

test('T05 review: cleanup cannot release a paused receive initialization while its owner can still write', async () => {
  const t = await setup(),
    entered = deferred(),
    release = deferred()
  let running
  try {
    const a = await t.create(),
      put = t.store.putOnce.bind(t.store)
    t.store.putOnce = async (...args) => {
      await args[5]()
      entered.resolve()
      await release.promise
      return put(...args)
    }
    running = t.service.receive(
      a.uploadId,
      a.uploadToken,
      Readable.from([Buffer.alloc(100)]),
      'application/zip'
    )
    const rejected = assert.rejects(running, /STATE_CONFLICT/)
    await entered.promise
    t.advance(86400_000)
    await t.service.expireUploads()
    await assert.rejects(t.service.cleanupUpload(a.uploadId), /STATE_CONFLICT/)
    assert.equal((await t.db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 100n)
    release.resolve()
    await rejected
    await t.service.cleanupUpload(a.uploadId)
  } finally {
    release.resolve()
    if (running) await running.catch(() => {})
    await t.close()
  }
})

test('T05 review: total task deadline aborts a stalled object staging stream before any container starts', async () => {
  const t = await setup({ checkWallMs: 50 }),
    blocked = new Readable({ read() {} })
  let task
  try {
    const a = await t.create()
    await t.service.receive(
      a.uploadId,
      a.uploadToken,
      Readable.from([Buffer.alloc(100)]),
      'application/zip'
    )
    await t.service.completeUpload(t.f.seller, a.uploadId)
    t.store.read = async () => blocked
    let starts = 0
    const checker = {
      async check() {
        starts++
        throw new Error('must not launch')
      },
      async terminate() {
        return true
      }
    }
    task = t.service.checkNext(checker, t.root + '/scratch')
    const result = await Promise.race([
      task,
      new Promise((done) => setTimeout(() => done('not_finished'), 500))
    ])
    assert.notEqual(result, 'not_finished')
    assert.equal(result.status, 'check_timeout')
    assert.equal(starts, 0)
    assert.equal((await t.db.client.privateFileGlobal.findFirstOrThrow()).checking, 0)
  } finally {
    blocked.destroy(new Error('test complete'))
    if (task) await task.catch(() => {})
    await t.close()
  }
})

test('T05 review: reaper cannot free a slot or let a stale staging owner launch after cancellation', async () => {
  const t = await setup(),
    entered = deferred(),
    release = deferred()
  let task
  try {
    const a = await t.create()
    await t.service.receive(
      a.uploadId,
      a.uploadToken,
      Readable.from([Buffer.alloc(100)]),
      'application/zip'
    )
    await t.service.completeUpload(t.f.seller, a.uploadId)
    const read = t.store.read.bind(t.store)
    t.store.read = async (key) => {
      entered.resolve()
      await release.promise
      return read(key)
    }
    let starts = 0
    const checker = {
      async check() {
        starts++
        return { status: 'rejected', reason: 'TEST', processStopped: true }
      },
      async terminate() {
        return true
      }
    }
    task = t.service.checkNext(checker, t.root + '/scratch')
    const completed = task.catch(() => null)
    await entered.promise
    t.advance(150000)
    await t.service.reapChecks(checker, t.root + '/scratch')
    assert.equal((await t.db.client.privateFileGlobal.findFirstOrThrow()).checking, 1)
    release.resolve()
    await completed
    assert.equal(starts, 0)
    await t.service.reapChecks(checker, t.root + '/scratch')
    assert.equal((await t.db.client.privateFileGlobal.findFirstOrThrow()).checking, 0)
  } finally {
    release.resolve()
    if (task) await task.catch(() => {})
    await t.close()
  }
})

test('T05 local process drill: SIGKILL a staging owner, restart the supervisor, and reclaim only that stopped job', async () => {
  const t = await setup(),
    { spawn } = await import('node:child_process')
  let child
  try {
    const a = await t.create()
    await t.service.receive(
      a.uploadId,
      a.uploadToken,
      Readable.from([Buffer.alloc(100)]),
      'application/zip'
    )
    await t.service.completeUpload(t.f.seller, a.uploadId)
    const dbModule = new URL('../dist/database/database.service.js', import.meta.url).href,
      fileModule = new URL('../dist/delivery-files/upload.service.js', import.meta.url).href,
      storeModule = new URL('../dist/delivery-files/object-store.js', import.meta.url).href
    const code = `import {DatabaseService} from ${JSON.stringify(dbModule)};
    import {PrivateFileService} from ${JSON.stringify(fileModule)};
    import {LocalPrivateObjectStore} from ${JSON.stringify(storeModule)};
    const db=new DatabaseService(process.env.PRIVATE_TEST_DB);await db.onModuleInit();
    const store=new LocalPrivateObjectStore(process.env.PRIVATE_TEST_ROOT);
    store.read=async()=>{process.stdout.write('staging\\n');await new Promise(()=>{})};
    const service=new PrivateFileService(db.client,store,{globalBytes:8000000000,globalUploads:8,checkConcurrency:1,checkQueue:4},Buffer.alloc(32,7));
    setInterval(()=>{},1000);
    await service.checkNext({check:async()=>{process.stdout.write('unexpected-start\\n');throw new Error('unexpected')},terminate:async()=>true},process.env.PRIVATE_TEST_ROOT+'/scratch');`
    child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: {
        PATH: process.env.PATH,
        PRIVATE_TEST_DB: t.db.url.toString(),
        PRIVATE_TEST_ROOT: t.root
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const exit = new Promise((done) => child.once('exit', done))
    let observed = ''
    await new Promise((done, reject) => {
      child.stdout.on('data', (b) => {
        observed += String(b)
        if (observed.includes('staging\n')) done()
      })
      child.once('error', reject)
      child.once('exit', () => {
        if (!observed.includes('staging\n')) reject(new Error('staging child exited early'))
      })
    })
    const checking = await t.db.client.privateUpload.findUniqueOrThrow({
      where: { id: a.uploadId }
    })
    assert.equal(checking.checkOwnerPid, child.pid)
    assert.equal((await t.db.client.privateFileGlobal.findFirstOrThrow()).checking, 1)
    child.kill('SIGKILL')
    await exit
    t.advance(150000)
    // This fixture never started a container; no-container termination is therefore known.
    const restarted = {
      async check() {
        throw new Error('must not start')
      },
      async terminate() {
        return true
      }
    }
    assert.equal(await t.service.reapChecks(restarted, t.root + '/scratch'), 1)
    assert.equal((await t.db.client.privateFileGlobal.findFirstOrThrow()).checking, 0)
    assert.equal((await t.db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 100n)
    await t.service.cleanupUpload(a.uploadId)
    assert.equal((await t.db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 0n)
    assert.doesNotMatch(observed, /unexpected-start/)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await t.close()
  }
})

test('T05 runtime role can reserve, receive and check private versions but cannot rewrite their identity', async () => {
  const t = await setup(),
    { connect, testUrl } = await import('./helpers/database.mjs'),
    { grantRuntime } = await import('../scripts/runtime-grants.mjs')
  const admin = await connect(testUrl()),
    role = 'pfr_' + randomUUID().replaceAll('-', ''),
    password = randomUUID()
  let restricted
  try {
    await admin.client.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
    )
    await grantRuntime(t.db.client, t.db.schema, role)
    const url = new URL(t.db.url)
    url.username = role
    url.password = password
    restricted = await connect(url)
    const service = new PrivateFileService(
      restricted.client,
      t.store,
      { globalBytes: 8000000000, globalUploads: 8, checkConcurrency: 1, checkQueue: 4 },
      Buffer.alloc(32, 7)
    )
    const a = await service.createUpload(
      t.f.seller,
      t.orderId,
      { purpose: 'delivery', filename: 'one.zip', contentType: 'application/zip', byteSize: 100 },
      'restricted-file'
    )
    await service.receive(
      a.uploadId,
      a.uploadToken,
      Readable.from([Buffer.alloc(100)]),
      'application/zip'
    )
    await service.completeUpload(t.f.seller, a.uploadId)
    const row = await t.db.client.privateUpload.findUniqueOrThrow({ where: { id: a.uploadId } })
    const checker = {
      async check() {
        return {
          status: 'clean',
          reason: 'CHECKS_PASSED',
          processStopped: true,
          bytes: 100,
          sha256: row.sha256,
          contentType: 'application/zip',
          structural: true,
          malware: {
            clean: true,
            engine: 'ClamAV',
            version: 'substitute-only',
            signatureDate: '2026-11-08'
          }
        }
      },
      async terminate() {
        return true
      }
    }
    assert.equal((await service.checkNext(checker, t.root + '/restricted-scratch')).status, 'ready')
    const version = await restricted.client.privateFileVersion.findUniqueOrThrow({
      where: { uploadId: a.uploadId }
    })
    await assert.rejects(
      restricted.client.privateFileVersion.update({
        where: { id: version.id },
        data: { purpose: 'evidence' }
      }),
      /permission denied/
    )
    await assert.rejects(
      restricted.client.privateUpload.update({
        where: { id: a.uploadId },
        data: { objectKey: 'objects/other/key' }
      }),
      /permission denied/
    )
    await assert.rejects(
      restricted.client.privateFileGlobal.update({
        where: { singleton: true },
        data: { maintenance: true }
      }),
      /permission denied/
    )
  } finally {
    if (restricted) await restricted.onModuleDestroy()
    await t.close()
    await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})
