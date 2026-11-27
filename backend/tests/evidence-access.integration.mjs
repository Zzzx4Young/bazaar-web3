import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { testnetFixture } from './helpers/testnet.mjs'
import { LocalPrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { DownloadService } from '../dist/delivery-files/download.service.js'
import { chainScope, deploymentDigest, lockChain } from '../dist/web3/escrow-projector.js'
import { bounded, deferred } from './helpers/database.mjs'

// The parent runs this file before installing the staged implementation.
const implementation = await import('../dist/evidence/evidence.service.js').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  return {}
})
const consent = { text: 'Visible to both order participants', consent: true }
async function setup() {
  assert.equal(typeof implementation.EvidenceService, 'function', 'F03 EvidenceService is required')
  const t = await testnetFixture()
  let root
  try {
    await t.bind()
    await t.confirm()
    await t.price('1.000001')
    const orderId = await t.create()
    const hash = (n) => '0x' + n.toString(16).padStart(64, '0')
    const deployment = {
      deploymentBlock: '0',
      escrowCodeHash: hash(1),
      tokenCodeHash: hash(2),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    // Evidence has no payment/projection prerequisite, but byte grants require
    // an explicit deployment and active recovery cursor in every fixture.
    t.config.chainDeployment = deployment
    await t.db.client.scanCheckpoint.create({
      data: {
        scope: chainScope(t.config),
        configHash: deploymentDigest(t.config, deployment),
        deploymentBlock: 0n,
        height: 10n,
        hash: hash(100),
        status: 'active',
        globals: { paused: false }
      }
    })
    await t.db.client.chainBlock.create({
      data: {
        scope: chainScope(t.config),
        height: 10n,
        hash: hash(100),
        parentHash: hash(99),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      }
    })
    await t.db.client.chainSnapshot.create({
      data: {
        scope: chainScope(t.config),
        height: 10n,
        hash: hash(100),
        ordersHash: 'a'.repeat(64),
        stocksHash: 'b'.repeat(64),
        globals: { paused: false }
      }
    })
    root = await mkdtemp(join(tmpdir(), 'bazaar-evidence-'))
    const store = new LocalPrivateObjectStore(root)
    const downloads = new DownloadService(
      t.db.client,
      t.config,
      store,
      'http://127.0.0.1:9999',
      Buffer.alloc(32, 8)
    )
    const service = new implementation.EvidenceService(t.db.client, t.config, downloads)
    const version = async (purpose = 'evidence', ownerId = t.f.seller) => {
      const id = randomUUID(),
        checkId = randomUUID(),
        versionId = randomUUID()
      const bytes = Buffer.from('%PDF-1.7 evidence ' + id)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const objectKey = 'objects/' + ownerId + '/' + id
      await store.putOnce(objectKey, Readable.from([bytes]), bytes.length, 'application/pdf')
      await t.db.client.privateUpload.create({
        data: {
          id,
          accountId: ownerId,
          orderId,
          purpose,
          key: id,
          requestHash: 'a'.repeat(64),
          tokenHash: 'b'.repeat(64),
          filename: 'evidence.pdf',
          contentType: 'application/pdf',
          declaredBytes: bytes.length,
          actualBytes: bytes.length,
          sha256,
          objectKey,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          status: 'ready',
          checkId
        }
      })
      await t.db.client.privateFileCheck.create({
        data: {
          id: checkId,
          uploadId: id,
          report: { status: 'clean' }
        }
      })
      return t.db.client.privateFileVersion.create({
        data: {
          id: versionId,
          uploadId: id,
          orderId,
          ownerId,
          purpose,
          objectKey,
          objectVersion: id,
          sha256,
          byteSize: bytes.length,
          contentType: 'application/pdf',
          filename: 'evidence.pdf',
          checkId
        }
      })
    }
    const authorizeReviewer = async (options = {}) => {
      await t.db.client.account.update({ where: { id: t.f.other }, data: { role: 'admin' } })
      return t.db.client.reviewAuthorization.create({
        data: {
          orderId,
          accountId: t.f.other,
          expiresAt: new Date(Date.now() + 60000),
          ...options
        }
      })
    }
    return {
      ...t,
      orderId,
      store,
      downloads,
      service,
      version,
      authorizeReviewer,
      close: async () => {
        await t.close()
        await rm(root, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await t.close()
    if (root) await rm(root, { recursive: true, force: true })
    throw error
  }
}

const submit = (t, actor = t.f.seller, input = consent, key = randomUUID(), guard) =>
  t.service.submitEvidence(t.orderId, actor, input, key, guard)

test('F03: bilateral consent, own submissions and immutable append before payment', async () => {
  const t = await setup()
  try {
    for (const value of [undefined, false, 'true', 1])
      await assert.rejects(
        submit(t, t.f.seller, { text: 'secret', consent: value }),
        /INVALID_INPUT/
      )
    await assert.rejects(submit(t, t.f.other), /FORBIDDEN/)
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, submitterId: t.f.buyer }),
      /INVALID_INPUT/
    )
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, visibility: 'private' }),
      /INVALID_INPUT/
    )
    await assert.rejects(
      submit(t, t.f.seller, { text: 'x'.repeat(10001), consent: true }),
      /INVALID_INPUT/
    )
    await assert.rejects(submit(t, t.f.seller, { consent: true }), /INVALID_INPUT/)
    const key = randomUUID(),
      first = await submit(t, t.f.seller, consent, key)
    assert.deepEqual(await submit(t, t.f.seller, consent, key), first)
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, text: 'changed' }, key),
      /IDEMPOTENCY_CONFLICT/
    )
    const appended = await t.service.appendEvidence(
      t.orderId,
      t.f.seller,
      first.id,
      { text: 'Correction by original submitter', consent: true },
      randomUUID()
    )
    assert.equal(appended.parentId, first.id)
    await assert.rejects(
      t.service.appendEvidence(t.orderId, t.f.buyer, first.id, consent, randomUUID()),
      /FORBIDDEN/
    )
    const buyer = await submit(t, t.f.buyer)
    const read = await t.service.readEvidence(t.orderId, t.f.buyer)
    assert.deepEqual(
      new Set(read.evidence.map((row) => row.id)),
      new Set([first.id, appended.id, buyer.id])
    )
    assert.equal(read.evidence.find((row) => row.id === first.id).text, consent.text)
    assert.equal(read.visibility, 'order_participants')
    assert.equal(read.fundsAffected, false)
    assert.equal(await t.db.client.evidenceRecord.count(), 3)
    assert.ok(await t.db.client.fileAccessAudit.count({ where: { action: 'evidence_read' } }))
  } finally {
    await t.close()
  }
})

test('F03: checked exact evidence attachments, ownership and unpublished uploads', async () => {
  const t = await setup()
  try {
    const own = await t.version(),
      other = await t.version('evidence', t.f.buyer)
    const delivery = await t.version('delivery')
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, versionId: other.id }),
      /STATE_CONFLICT|FORBIDDEN/
    )
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, versionId: delivery.id }),
      /STATE_CONFLICT/
    )
    await assert.rejects(
      t.service.authorizeEvidenceAttachment(t.orderId, own.id, t.f.buyer),
      /NOT_FOUND/
    )
    await t.db.client.privateUpload.update({
      where: { id: own.uploadId },
      data: { status: 'quarantined' }
    })
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, versionId: own.id }),
      /FILE_UNAVAILABLE/
    )
    assert.equal(await t.db.client.evidenceRecord.count(), 0)
    await t.db.client.privateUpload.update({
      where: { id: own.uploadId },
      data: { status: 'ready' }
    })
    await t.db.client.privateFileCheck.update({
      where: { id: own.checkId },
      data: { report: { status: 'infected' } }
    })
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, versionId: own.id }),
      /FILE_UNAVAILABLE/
    )
    await t.db.client.privateFileCheck.update({
      where: { id: own.checkId },
      data: { report: { status: 'clean' } }
    })
    const record = await submit(t, t.f.seller, { consent: true, versionId: own.id })
    const link = await t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer)
    assert.equal(new Date(link.expiresAt).getTime() - link.issuedAt, 300000)
    assert.match(link.url, /^http:\/\/127\.0\.0\.1:9999\/downloads\//)
    const grant = await t.db.client.downloadGrant.findUniqueOrThrow({ where: { id: link.id } })
    assert.equal(grant.versionId, own.id)
    assert.equal(grant.purpose, 'evidence')
    assert.equal(grant.basis.evidenceId, record.id)
    const response = await t.downloads.readCapability(link.id, link.token)
    const bytes = Buffer.concat(await Readable.from(response.body).toArray())
    assert.equal(createHash('sha256').update(bytes).digest('hex'), own.sha256)
    const read = await t.service.readEvidence(t.orderId, t.f.buyer)
    assert.equal(read.evidence[0].attachment.sha256, own.sha256)
    assert.doesNotMatch(
      JSON.stringify(read),
      /objectKey|objectVersion|tokenHash|salt|signature|requestHash/
    )
    await t.store.deleteAndConfirm(own.objectKey)
    const grantsBefore = await t.db.client.downloadGrant.count()
    await assert.rejects(
      t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer),
      /FILE_UNAVAILABLE/
    )
    assert.equal(await t.db.client.downloadGrant.count(), grantsBefore)
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, versionId: own.id }),
      /FILE_UNAVAILABLE/
    )
    await t.db.client.privateUpload.update({
      where: { id: own.uploadId },
      data: { status: 'cleaned' }
    })
    const removed = await t.service.readEvidence(t.orderId, t.f.buyer)
    assert.equal(removed.evidence[0].attachment.available, false)
    await assert.rejects(
      t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer),
      /FILE_UNAVAILABLE/
    )
  } finally {
    await t.close()
  }
})

test('F03: refund preserves evidence reads but delivery references never mint byte access', async () => {
  const t = await setup()
  try {
    const originalOrder = await t.db.client.order.findUniqueOrThrow({ where: { id: t.orderId } })
    const raw = await t.version('delivery'),
      attachment = await t.version()
    const reference = await submit(t, t.f.seller, { ...consent, deliveryReferenceId: raw.id })
    const evidence = await submit(t, t.f.seller, { ...consent, versionId: attachment.id })
    await t.db.client.order.update({ where: { id: t.orderId }, data: { status: 'refunded' } })
    const read = await t.service.readEvidence(t.orderId, t.f.buyer)
    assert.equal(
      read.evidence.find((row) => row.id === reference.id).deliveryReference.versionId,
      raw.id
    )
    assert.doesNotMatch(JSON.stringify(read), /objectKey|objectVersion|salt|signature/)
    await assert.rejects(
      t.service.authorizeEvidenceAttachment(t.orderId, reference.id, t.f.buyer),
      /STATE_CONFLICT/
    )
    await assert.rejects(submit(t, t.f.buyer, { ...consent, versionId: raw.id }), /STATE_CONFLICT/)
    const link = await t.service.authorizeEvidenceAttachment(t.orderId, evidence.id, t.f.buyer)
    assert.equal(
      (await t.db.client.downloadGrant.findUniqueOrThrow({ where: { id: link.id } })).purpose,
      'evidence'
    )
    const current = await t.db.client.order.findUniqueOrThrow({ where: { id: t.orderId } })
    assert.equal(current.version, originalOrder.version)
    assert.equal(await t.db.client.settlementRecord.count(), 0)
  } finally {
    await t.close()
  }
})

test('F03: review requires active scoped administrator, expiry and current role; audit only, no funds', async () => {
  const t = await setup()
  try {
    const version = await t.version()
    const record = await submit(t, t.f.seller, { ...consent, versionId: version.id })
    const original = await t.db.client.order.findUniqueOrThrow({ where: { id: t.orderId } })
    await t.db.client.account.update({ where: { id: t.f.other }, data: { role: 'admin' } })
    await assert.rejects(t.service.readEvidence(t.orderId, t.f.other), /FORBIDDEN/)
    await assert.rejects(t.service.closeReview(t.orderId, t.f.other, randomUUID()), /FORBIDDEN/)
    await assert.rejects(t.service.closeReview(t.orderId, t.f.buyer, randomUUID()), /FORBIDDEN/)
    const expired = await t.authorizeReviewer({ expiresAt: new Date(Date.now() - 1000) })
    await assert.rejects(t.service.readEvidence(t.orderId, t.f.other), /FORBIDDEN/)
    assert.ok(expired.id)
    const scope = await t.authorizeReviewer()
    const read = await t.service.readEvidence(t.orderId, t.f.other)
    assert.equal(read.evidence[0].id, record.id)
    const link = await t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.other)
    const grant = await t.db.client.downloadGrant.findUniqueOrThrow({ where: { id: link.id } })
    assert.equal(grant.basis.authorizationId, scope.id)
    assert.equal(grant.purpose, 'evidence')
    const key = randomUUID(),
      closed = await t.service.closeReview(t.orderId, t.f.other, key)
    assert.equal(closed.action, 'close')
    assert.equal(closed.fundsAffected, false)
    assert.deepEqual(await t.service.closeReview(t.orderId, t.f.other, key), closed)
    await assert.rejects(t.service.reopenReview(t.orderId, t.f.other, key), /IDEMPOTENCY_CONFLICT/)
    await assert.rejects(
      t.service.closeReview(t.orderId, t.f.other, randomUUID()),
      /STATE_CONFLICT/
    )
    const reopened = await t.service.reopenReview(t.orderId, t.f.other, randomUUID())
    assert.equal(reopened.action, 'reopen')
    assert.equal((await t.service.readEvidence(t.orderId, t.f.buyer)).reviewState, 'open')
    assert.equal(await t.db.client.reviewEvent.count(), 2)
    assert.ok(await t.db.client.fileAccessAudit.count({ where: { action: 'review_close' } }))
    assert.ok(await t.db.client.fileAccessAudit.count({ where: { action: 'review_reopen' } }))
    assert.match(JSON.stringify(await t.db.client.fileAccessAudit.findMany()), new RegExp(scope.id))
    assert.deepEqual(
      await t.db.client.order.findUniqueOrThrow({ where: { id: t.orderId } }),
      original
    )
    await t.db.client.account.update({ where: { id: t.f.other }, data: { role: 'observer' } })
    await assert.rejects(t.service.readEvidence(t.orderId, t.f.other), /FORBIDDEN/)
    await assert.rejects(t.service.closeReview(t.orderId, t.f.other, key), /FORBIDDEN/)
  } finally {
    await t.close()
  }
})

test('F03: active-account checks and final session guard cover reads and idempotent retries', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      version = await t.version()
    const record = await submit(t, t.f.seller, { ...consent, versionId: version.id }, key)
    const scope = await t.authorizeReviewer()
    const closeKey = randomUUID()
    await t.service.closeReview(t.orderId, t.f.other, closeKey)
    const denied = async () => {
      throw new Error('SESSION_REVOKED')
    }
    const protectedCalls = [
      () => submit(t, t.f.seller, { ...consent, versionId: version.id }, key, denied),
      () =>
        t.service.appendEvidence(t.orderId, t.f.seller, record.id, consent, randomUUID(), denied),
      () => t.service.readEvidence(t.orderId, t.f.buyer, denied),
      () => t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer, denied),
      () => t.service.closeReview(t.orderId, t.f.other, closeKey, denied),
      () => t.service.reopenReview(t.orderId, t.f.other, randomUUID(), denied)
    ]
    for (const call of protectedCalls) await assert.rejects(call(), /SESSION_REVOKED/)
    for (const actor of [t.f.seller, t.f.buyer, t.f.other])
      await t.db.client.account.update({ where: { id: actor }, data: { status: 'disabled' } })
    await assert.rejects(
      submit(t, t.f.seller, { ...consent, versionId: version.id }, key),
      /FORBIDDEN/
    )
    await assert.rejects(t.service.readEvidence(t.orderId, t.f.buyer), /FORBIDDEN/)
    await assert.rejects(
      t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer),
      /FORBIDDEN/
    )
    await assert.rejects(t.service.closeReview(t.orderId, t.f.other, closeKey), /FORBIDDEN/)
    assert.equal(await t.db.client.downloadGrant.count(), 0)
    assert.equal(await t.db.client.reviewAuthorization.count({ where: { id: scope.id } }), 1)
  } finally {
    await t.close()
  }
})

test('F03: order scopes, parent scopes and actor-wide idempotency cannot cross orders', async () => {
  const t = await setup()
  try {
    const order = await t.db.client.order.create({
      data: {
        listingId: t.f.listing.id,
        sellerId: t.f.seller,
        buyerId: t.f.buyer,
        settlementMode: 'testnet_escrow'
      }
    })
    const key = randomUUID(),
      record = await submit(t, t.f.seller, consent, key)
    await assert.rejects(
      t.service.submitEvidence(order.id, t.f.seller, consent, key),
      /IDEMPOTENCY_CONFLICT/
    )
    await assert.rejects(
      t.service.appendEvidence(order.id, t.f.seller, record.id, consent, randomUUID()),
      /NOT_FOUND/
    )
    await t.authorizeReviewer()
    await assert.rejects(t.service.readEvidence(order.id, t.f.other), /FORBIDDEN/)
    const own = await t.version(),
      ev = await submit(t, t.f.seller, { ...consent, versionId: own.id })
    await assert.rejects(
      t.service.authorizeEvidenceAttachment(order.id, ev.id, t.f.buyer),
      /NOT_FOUND/
    )
    await assert.rejects(
      t.service.submitEvidence(
        order.id,
        t.f.seller,
        { ...consent, versionId: own.id },
        randomUUID()
      ),
      /STATE_CONFLICT/
    )
  } finally {
    await t.close()
  }
})

test('F03: guard executes only after shared chain lock; concurrent retries publish once', async () => {
  const t = await setup()
  const locked = deferred(),
    release = deferred(),
    guardEntered = deferred()
  let holder, read, holderPid
  let guardRan = false
  try {
    const key = randomUUID()
    const rows = await Promise.all([
      submit(t, t.f.seller, consent, key),
      submit(t, t.f.seller, consent, key)
    ])
    assert.equal(rows[0].id, rows[1].id)
    assert.equal(await t.db.client.evidenceRecord.count(), 1)
    holder = t.db.client.$transaction(async (tx) => {
      await lockChain(tx, chainScope(t.config))
      holderPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid
      locked.resolve()
      await bounded(release.promise, 'shared chain lock release')
    })
    holder.catch(() => {})
    await bounded(locked.promise, 'shared chain lock acquired')
    read = t.service.readEvidence(t.orderId, t.f.buyer, async (tx) => {
      assert.ok(tx.account)
      guardRan = true
      guardEntered.resolve()
    })
    read.catch(() => {})
    // Observe an actual lock wait rather than assuming Promise.all creates a race.
    await bounded(
      (async () => {
        for (;;) {
          const rows = await t.db.client
            .$queryRaw`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND ${holderPid}::int = ANY(pg_blocking_pids(pid))`
          if (rows[0].count > 0) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      })(),
      'evidence reader must wait for chain lock'
    )
    assert.equal(guardRan, false)
    release.resolve()
    await bounded(guardEntered.promise, 'guard runs after chain lock release')
    await Promise.all([holder, read])
  } finally {
    release.resolve()
    await Promise.allSettled([holder, read].filter(Boolean))
    await t.close()
  }
})

test('F03 controller: POST routes validate IDs/keys/body, rate limit and forward final session guards', async () => {
  const { EvidenceController } = await import('../dist/evidence/evidence.controller.js')
  const calls = [],
    limits = [],
    readLimits = [],
    guardCalls = []
  const account = { id: randomUUID(), role: 'participant', status: 'active' }
  const user = { account, token: 'virtual-session', tokenHash: 'virtual-hash' }
  const request = { ip: '127.0.0.1', auth: user }
  const auth = {
    async rateLimitWallet(key) {
      limits.push(key)
    },
    async rateLimitWalletRead(accountId, ip, scope) { readLimits.push({ accountId, ip, scope }) },
    async authenticate(cookie) {
      assert.equal(cookie, 'bazaar_session=virtual-session')
      return user
    }
  }
  const service = Object.fromEntries(
    [
      'submitEvidence',
      'appendEvidence',
      'readEvidence',
      'authorizeEvidenceAttachment',
      'closeReview',
      'reopenReview'
    ].map((name) => [
      name,
      async (...args) => {
        const guard = args.at(-1)
        assert.equal(typeof guard, 'function')
        await guard({
          $queryRaw: async (...args) => {
            guardCalls.push(args)
            return []
          }
        })
        calls.push({ name, args: args.slice(0, -1) })
        return { ok: true }
      }
    ])
  )
  const controller = new EvidenceController(service, auth)
  const orderId = randomUUID(),
    evidenceId = randomUUID(),
    key = randomUUID()
  await controller.submit(orderId.toUpperCase(), consent, request, key)
  await controller.append(orderId, { ...consent, parentId: evidenceId }, request, key)
  await controller.read(orderId, {}, request)
  await controller.authorize(orderId, { evidenceId }, request)
  await controller.close(orderId, {}, request, key)
  await controller.reopen(orderId, {}, request, key)
  assert.deepEqual(
    calls.map((call) => call.name),
    Object.keys(service)
  )
  assert.equal(calls[0].args[0], orderId)
  assert.deepEqual(calls[1].args, [orderId, account.id, evidenceId, consent, key])
  assert.deepEqual(calls[3].args, [orderId, evidenceId, account.id])
  assert.equal(limits.length, 5)
  assert.deepEqual(readLimits, [{ accountId: account.id, ip: request.ip, scope: 'evidence' }])
  assert.ok(limits.every((key) => key === 'evidence:127.0.0.1'))
  assert.equal(guardCalls.length, 12, 'each forwarded guard locks Account and Session')
  for (const call of [
    () => controller.submit('bad-id', consent, request, key),
    () => controller.submit(orderId, consent, request, ['duplicate', 'keys']),
    () => controller.append(orderId, { ...consent, parentId: 'invalid' }, request, key),
    () => controller.read(orderId, { unexpected: true }, request),
    () => controller.authorize(orderId, { evidenceId: 'invalid' }, request),
    () => controller.close(orderId, { status: 'refund' }, request, key),
    () => controller.reopen(orderId, {}, request, '')
  ])
    await assert.rejects(call(), /INVALID_INPUT/)
  assert.equal(calls.length, 6, 'invalid requests never reach the service')
  await assert.rejects(
    new EvidenceController(null, auth).read(orderId, {}, request),
    /FILE_UNAVAILABLE/
  )
  assert.equal(Reflect.getMetadata('path', EvidenceController), 'web3/orders/:id')
  const routes = {
    submit: 'evidence',
    append: 'evidence/append',
    read: 'evidence/read',
    authorize: 'evidence/attachments/authorize',
    close: 'review/close',
    reopen: 'review/reopen'
  }
  for (const [method, path] of Object.entries(routes)) {
    const handler = EvidenceController.prototype[method]
    assert.equal(Reflect.getMetadata('path', handler), path)
    assert.equal(Reflect.getMetadata('method', handler), 1, 'POST only')
    assert.equal(Reflect.getMetadata('__httpCode__', handler), 200)
    assert.ok(
      Reflect.getMetadata('__headers__', handler).some(
        (header) => header.name === 'Cache-Control' && header.value === 'no-store'
      )
    )
  }
})

test('F03/P2: recovering checkpoint blocks evidence grants but preserves text reads', async () => {
  const t = await setup()
  try {
    const version = await t.version()
    const record = await submit(t, t.f.seller, { ...consent, versionId: version.id })
    const activeGrant = await t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer)
    assert.ok(activeGrant.id, 'the pinned active fixture grants its checked published attachment')
    const before = await t.db.client.downloadGrant.count()
    await t.db.client.scanCheckpoint.update({
      where: { scope: chainScope(t.config) },
      data: { status: 'recovering' }
    })
    const read = await t.service.readEvidence(t.orderId, t.f.buyer)
    assert.equal(read.evidence.find((row) => row.id === record.id).text, consent.text)
    await assert.rejects(
      t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer),
      /FILE_UNAVAILABLE/
    )
    assert.equal(await t.db.client.downloadGrant.count(), before)
    await t.db.client.scanCheckpoint.update({
      where: { scope: chainScope(t.config) },
      data: { status: 'active' }
    })
    const resumed = await t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.buyer)
    assert.notEqual(resumed.id, activeGrant.id)
    assert.equal(await t.db.client.downloadGrant.count(), before + 1)
  } finally {
    await t.close()
  }
})

test('F03/P2: reviewer expiry during the second storage probe prevents evidence grant', async () => {
  const t = await setup()
  const secondProbe = deferred(),
    releaseProbe = deferred()
  const originalRead = t.store.read.bind(t.store)
  let pending, outcome
  let probes = 0
  try {
    const version = await t.version()
    const record = await submit(t, t.f.seller, { ...consent, versionId: version.id })
    const scope = await t.authorizeReviewer()
    // Count only authorization reads: EvidenceService probes first, then
    // DownloadService.grant performs the last storage await before minting.
    t.store.read = async (key, signal) => {
      assert.equal(key, version.objectKey)
      probes++
      if (probes === 2) {
        secondProbe.resolve()
        await bounded(releaseProbe.promise, 'second evidence probe must be released')
      }
      return originalRead(key, signal)
    }
    pending = t.service.authorizeEvidenceAttachment(t.orderId, record.id, t.f.other)
    outcome = pending.then(
      (value) => ({ value }),
      (error) => ({ error })
    )
    await bounded(secondProbe.promise, 'grant must enter the second storage probe')
    // This sandbox client is the schema owner, not the SELECT-only runtime
    // role. Move expiry while storage is paused; do not mutate app privileges.
    await t.db.client.reviewAuthorization.update({
      where: { id: scope.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    })
    releaseProbe.resolve()
    const result = await bounded(outcome, 'expired reviewer authorization must finish')
    assert.equal(probes, 2, 'expiry occurs after the service check, inside grant storage I/O')
    assert.ok(
      result.error,
      'reviewer expiry during the last probe must reject, not mint a capability'
    )
    assert.match(result.error.message, /FORBIDDEN/)
    assert.equal(await t.db.client.downloadGrant.count(), 0)
    assert.equal(
      await t.db.client.fileAccessAudit.count({
        where: { action: { in: ['evidence_authorize', 'evidence_attachment_authorize'] } }
      }),
      0
    )
  } finally {
    releaseProbe.resolve()
    if (outcome) await outcome
    t.store.read = originalRead
    await t.close()
  }
})

test('F03: owner changes to review scope are audited without granting runtime configuration rights', async () => {
  const t = await setup()
  try {
    const scope = await t.authorizeReviewer()
    const created = await t.db.client.fileAccessAudit.findFirst({
      where: { orderId: t.orderId, action: 'review_scope_insert' }
    })
    assert.ok(created, 'scope provisioning must leave an immutable audit event')
    assert.equal(created.details.authorizationId, scope.id)
    await t.db.client.reviewAuthorization.update({
      where: { id: scope.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    })
    assert.ok(
      await t.db.client.fileAccessAudit.findFirst({
        where: { orderId: t.orderId, action: 'review_scope_update' }
      })
    )
    await t.db.client.reviewAuthorization.delete({ where: { id: scope.id } })
    assert.ok(
      await t.db.client.fileAccessAudit.findFirst({
        where: { orderId: t.orderId, action: 'review_scope_delete' }
      })
    )
  } finally {
    await t.close()
  }
})
