import test from 'node:test'
import assert from 'node:assert/strict'
const m = await import('../dist/delivery-files/deletion-ledger.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
test('T10: independent private lifecycle ledger is required before retention can delete anything', () => {
  assert.equal(
    typeof m.PrivateLifecycleLedger,
    'function',
    'independent immutable deletion ledger required'
  )
})
import { randomUUID } from 'node:crypto'
import { isolatedPrivateLedger } from './helpers/private-ledger.mjs'
import { retentionFixture } from './helpers/retention.mjs'
const service = await import('../dist/delivery-files/retention.service.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const retention = (t) => {
  assert.equal(typeof service.RetentionService, 'function', 'retention/deletion fencing required')
  return new service.RetentionService(t.db.client, t.config, t.store, t.p.ledger, t.now)
}

test('T10/A26:90-day boundary, failed physical deletion and idempotent quota release', async () => {
  const t = await retentionFixture()
  try {
    const v = await t.version(),
      s = retention(t)
    t.clock('2026-03-31T23:59:59.999Z')
    await assert.rejects(s.claimDeletion(v.id), /STATE_CONFLICT/)
    t.clock('2026-04-01T00:00:00Z')
    const claim = await s.claimDeletion(v.id)
    const used = (
      await t.db.client.privateFileQuota.findUniqueOrThrow({ where: { accountId: v.ownerId } })
    ).usedBytes
    const remove = t.store.deleteAndConfirm.bind(t.store)
    t.store.deleteAndConfirm = async () => {
      throw new Error('store failure')
    }
    await assert.rejects(s.confirmDeletion(claim.id))
    assert.equal(
      (await t.db.client.privateFileQuota.findUniqueOrThrow({ where: { accountId: v.ownerId } }))
        .usedBytes,
      used
    )
    assert.equal(
      (await t.db.client.privateFileDisposition.findUniqueOrThrow({ where: { versionId: v.id } }))
        .state,
      'claimed'
    )
    t.store.deleteAndConfirm = remove
    await s.confirmDeletion(claim.id)
    await s.confirmDeletion(claim.id)
    assert.equal(
      (await t.db.client.privateFileQuota.findUniqueOrThrow({ where: { accountId: v.ownerId } }))
        .usedBytes,
      0n
    )
    assert.equal(
      (await t.db.client.privateFileGlobal.findUniqueOrThrow({ where: { singleton: true } }))
        .usedBytes,
      0n
    )
    assert.equal((await t.p.ledger.find('deleted', v.id)).payload.claimId, claim.id)
    assert.equal(await t.db.client.privateFileVersion.count(), 1)
  } finally {
    await t.close()
  }
})
test('T10/A26: evidence takes latest 180-day closure; reopened or missing review basis protects', async () => {
  const t = await retentionFixture()
  try {
    const v = await t.version(),
      s = retention(t)
    await t.db.client.evidenceRecord.create({
      data: {
        id: randomUUID(),
        orderId: t.orderId,
        submitterId: t.f.buyer,
        key: randomUUID(),
        text: 'reference',
        deliveryReferenceId: v.id
      }
    })
    t.clock('2027-01-01')
    await assert.rejects(s.claimDeletion(v.id), /STATE_CONFLICT/)
    const row = await t.db.client.reviewEvent.create({
      data: {
        orderId: t.orderId,
        actorId: t.f.buyer,
        action: 'close',
        key: randomUUID(),
        createdAt: new Date('2026-02-01'),
        details: {}
      }
    })
    await t.p.ledger.append('review', row.id, { ...row, createdAt: row.createdAt.toISOString() })
    t.clock('2026-07-30T23:59:59.999Z')
    await assert.rejects(s.claimDeletion(v.id), /STATE_CONFLICT/)
    t.clock('2026-07-31')
    const eligible = await s.eligibility(v.id)
    assert.equal(eligible.eligible, true)
    await t.p.ledger.append('review', randomUUID(), {
      id: randomUUID(),
      orderId: t.orderId,
      action: 'reopen',
      createdAt: '2026-07-31T00:00:01Z'
    })
    await assert.rejects(s.claimDeletion(v.id), /STATE_CONFLICT/)
  } finally {
    await t.close()
  }
})
test('T10/A27: append-only deletion evidence remains verifiable and rollback is detected', async () => {
  const t = await isolatedPrivateLedger()
  try {
    const payload = {
      claimId: randomUUID(),
      versionId: randomUUID(),
      objectKey: 'objects/test',
      deadline: '2026-01-01'
    }
    await t.ledger.append('claim', payload.versionId, payload)
    await t.db.client.$executeRaw`DELETE FROM "PrivateLedgerEvent"`
    await assert.rejects(t.ledger.find('claim', payload.versionId), /UNAVAILABLE/)
  } finally {
    await t.close()
  }
})

test('T10: restricted lifecycle role appends evidence but cannot rewrite metadata, delete or truncate records', async () => {
  const { connect, testUrl } = await import('./helpers/database.mjs'),
    { randomBytes } = await import('node:crypto')
  const { assertPrivateLedgerGrants } =
    await import('../dist/delivery-files/private-ledger-grants.js')
  const p = await isolatedPrivateLedger(),
    admin = await connect(testUrl()),
    role = 'plr_' + randomUUID().replaceAll('-', ''),
    secret = randomBytes(24).toString('hex')
  let runtime,
    created = false
  try {
    const schema = p.url.searchParams.get('schema')
    await admin.client.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret}'`
    )
    created = true
    await p.db.client.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
    await p.db.client.$executeRawUnsafe(
      `GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`
    )
    await p.db.client.$executeRawUnsafe(
      `GRANT INSERT ON "${schema}"."PrivateLedgerEvent" TO "${role}"`
    )
    const url = new URL(p.url)
    url.username = role
    url.password = secret
    runtime = await connect(url)
    await assertPrivateLedgerGrants(runtime.client)
    const ledger = new m.PrivateLifecycleLedger(runtime.client, p.id, p.root)
    await ledger.append('claim', randomUUID(), { id: randomUUID() })
    await ledger.verify()
    await assert.rejects(
      runtime.client.$executeRaw`DELETE FROM "PrivateLedgerEvent"`,
      /permission denied/
    )
    await assert.rejects(
      runtime.client.$executeRaw`TRUNCATE "PrivateLedgerEvent"`,
      /permission denied/
    )
    await assert.rejects(
      runtime.client.$executeRaw`UPDATE "PrivateLedgerMeta" SET "maintenance"=true`,
      /permission denied/
    )
  } finally {
    if (runtime) await runtime.onModuleDestroy()
    await p.close()
    if (created) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})

test('T10: a durable claim with a rolled-back business fence still blocks a new download grant', async () => {
  const t = await retentionFixture(),
    original = t.db.client.$transaction.bind(t.db.client)
  try {
    const v = await t.version(),
      s = retention(t)
    t.clock('2026-04-01')
    t.db.client.$transaction = (work, options) =>
      original(async (tx) => {
        await work(tx)
        throw new Error('claim projection failed')
      }, options)
    await assert.rejects(s.claimDeletion(v.id), /claim projection failed/)
    t.db.client.$transaction = original
    assert.equal(await t.db.client.privateFileDisposition.count(), 0)
    assert.ok(await t.p.ledger.find('claim', v.id))
    const { DownloadService } = await import('../dist/delivery-files/download.service.js'),
      { Buffer } = await import('node:buffer')
    const d = new DownloadService(
      t.db.client,
      t.config,
      t.store,
      'http://localhost:9999',
      Buffer.alloc(32, 8),
      undefined,
      t.p.ledger
    )
    await assert.rejects(
      t.db.client.$transaction((tx) => d.grant(tx, t.orderId, v.id, t.f.buyer, 'delivery', {})),
      /UNAVAILABLE/
    )
  } finally {
    t.db.client.$transaction = original
    await t.close()
  }
})
test('T10: an independent evidence reference missing from the business projection prevents premature deletion', async () => {
  const t = await retentionFixture()
  try {
    const v = await t.version(),
      id = randomUUID()
    t.clock('2026-04-01')
    await t.p.ledger.append('evidence', id, {
      id,
      orderId: t.orderId,
      versionId: null,
      deliveryReferenceId: v.id,
      bodyHash: 'a'.repeat(64)
    })
    await assert.rejects(retention(t).claimDeletion(v.id), /STATE_CONFLICT/)
  } finally {
    await t.close()
  }
})
