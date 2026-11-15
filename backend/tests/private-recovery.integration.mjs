import test from 'node:test'
import assert from 'node:assert/strict'
const m = await import('../dist/delivery-files/private-recovery.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
test('T10 recovery coordinator must restore isolated and gate explicit complete validation', () => {
  assert.equal(
    typeof m.PrivateRecoveryService,
    'function',
    'isolated recovery coordinator required'
  )
})
import { randomUUID } from 'node:crypto'
import { retentionFixture } from './helpers/retention.mjs'
async function openingFixture() {
  const t = await retentionFixture(),
    runId = randomUUID(),
    backupId = randomUUID()
  await t.db.client.scanCheckpoint.update({
    where: { scope: t.scope },
    data: { status: 'recovering' }
  })
  await t.db.client.privateRecoveryState.create({
    data: {
      singleton: true,
      runId,
      backupId,
      downloadEpoch: randomUUID(),
      status: 'isolated',
      checks: { database: t.db.url.pathname }
    }
  })
  const r = new m.PrivateRecoveryService(
    { ledger: t.p.ledger, store: t.store },
    { verify: async () => {} },
    t.config,
    {}
  )
  r.validate = async () => ({
    database: t.db.url.pathname,
    missing: [],
    height: '10',
    hash: '0x' + (13).toString(16).padStart(64, '0'),
    watermark: ((await t.p.ledger.records()).at(-1)?.sequence ?? 0n).toString(),
    checkedAt: new Date().toISOString()
  })
  return { ...t, r, runId, backupId }
}
test('T10 review P1: a deletion appended after validation fences opening instead of publishing a stale clone', async () => {
  const t = await openingFixture()
  try {
    const original = t.r.validate
    t.r.validate = async () => {
      const checked = await original()
      await t.p.ledger.append('claim', randomUUID(), {
        claimId: randomUUID(),
        versionId: randomUUID()
      })
      return checked
    }
    await assert.rejects(t.r.open(t.db.client, t.store), /STATE_CONFLICT|changed/)
    assert.notEqual(
      (await t.db.client.privateRecoveryState.findUniqueOrThrow({ where: { singleton: true } }))
        .status,
      'active'
    )
  } finally {
    await t.close()
  }
})
test('T10 review P2: durable opening intent survives business rollback and retry does not conflict on checkedAt', async () => {
  const t = await openingFixture(),
    original = t.db.client.$transaction.bind(t.db.client)
  try {
    let fail = true
    t.db.client.$transaction = (work, options) =>
      original(async (tx) => {
        const out = await work(tx)
        if (fail) {
          fail = false
          throw new Error('injected target commit failure')
        }
        return out
      }, options)
    await assert.rejects(t.r.open(t.db.client, t.store), /injected target commit failure/)
    t.db.client.$transaction = original
    await t.r.open(t.db.client, t.store)
    assert.equal(
      (await t.db.client.privateRecoveryState.findUniqueOrThrow({ where: { singleton: true } }))
        .status,
      'active'
    )
  } finally {
    t.db.client.$transaction = original
    await t.close()
  }
})
test('T10 review P2: expired restored objects are deleted under isolation before service opening', async () => {
  const t = await openingFixture()
  try {
    const v = await t.version()
    await t.r.open(t.db.client, t.store)
    assert.equal(
      (await t.db.client.privateUpload.findUniqueOrThrow({ where: { id: v.uploadId } })).status,
      'cleaned'
    )
    assert.equal(
      (await t.db.client.privateFileDisposition.findUniqueOrThrow({ where: { versionId: v.id } }))
        .state,
      'deleted'
    )
    assert.ok(await t.p.ledger.find('deleted', v.id))
  } finally {
    await t.close()
  }
})

test('T10 review P1: restore runtime initializes usable ledgers even when the source database no longer exists', async () => {
  const { isolatedPrivateLedger } = await import('./helpers/private-ledger.mjs'),
    { readConfig } = await import('../dist/config.js'),
    { lifecycleRuntime } = await import('../scripts/private-lifecycle-runtime.mjs')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises'),
    { tmpdir } = await import('node:os'),
    { join } = await import('node:path')
  const p = await isolatedPrivateLedger(),
    root = await mkdtemp(join(tmpdir(), 'bazaar-lost-source-'))
  const old = process.env.PRIVATE_BACKUP_DATABASE_URL_FILE
  let r
  try {
    const source = new URL(p.url)
    source.pathname = '/lost_source_' + randomUUID().replaceAll('-', '')
    source.searchParams.set('schema', 'public')
    const file = join(root, 'owner-url')
    await writeFile(file, source.toString(), { mode: 0o600 })
    process.env.PRIVATE_BACKUP_DATABASE_URL_FILE = file
    const config = readConfig({ DATABASE_URL: source.toString() })
    config.web3 = { chainId: 11155111 }
    config.privateFiles = {
      store: {
        endpoint: 'http://127.0.0.1:1',
        bucket: 'unused',
        accessKeyId: 'test-only',
        secretAccessKey: 'test-only'
      }
    }
    config.privateLifecycle = { url: p.url.toString(), ledgerId: p.id, witnessDirectory: p.root }
    r = await lifecycleRuntime({ config, connectSource: false })
    await r.ledger.verify()
    await assert.rejects(r.source.ping(), /database.*does not exist|database.*not exist/i)
  } finally {
    if (r) await r.close()
    if (old === undefined) delete process.env.PRIVATE_BACKUP_DATABASE_URL_FILE
    else process.env.PRIVATE_BACKUP_DATABASE_URL_FILE = old
    await p.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('publication recovery refuses explicit opening when independent offchain declaration is unavailable', async () => {
  const t = await openingFixture()
  try {
    t.r.config.publication = {
      environmentId: 'isolated',
      configurationVersion: 'C5',
      configurationFile: '/missing-publication-config',
      configurationHash: 'a'.repeat(64),
      wakeSocket: '/missing-wake',
      openingFile: '/missing-opening',
      publicKeyFile: '/missing-pin',
      recoveryRunId: randomUUID(),
      walletLedgerId: randomUUID()
    }
    await assert.rejects(t.r.open(t.db.client, t.store), (e) => e.code === 'WALLET_UNAVAILABLE')
    assert.equal(
      (await t.db.client.privateRecoveryState.findUnique({ where: { singleton: true } })).status,
      'isolated'
    )
  } finally {
    await t.close()
  }
})
