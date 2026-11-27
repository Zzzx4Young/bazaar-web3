import { Buffer } from 'node:buffer'
import nodeTest from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { connect } from './helpers/database.mjs'
import { LedgerWitness } from '../dist/auth/ledger-witness.js'
import {
  readPendingPublications,
  readCommittedPublicationHeads,
  acknowledgePublication
} from '../dist/auth/publication-outbox.js'
import { LocalCheckpointPublicationStore } from '../dist/auth/checkpoint-publication.js'
import { LocalRecoveryAuthorizationJournal } from '../dist/auth/recovery-authorization-publication.js'
import { PublishedRecoveryConsumptionGuard } from '../dist/auth/recovery-consumption-checkpoint.js'
import { PublicationWorker, combinePublicationSources } from '../dist/auth/publication-worker.js'
const childMode = process.env.T10_PUBLICATION_CHILD === '1',
  test = childMode ? () => {} : nodeTest
const source = (client) => ({
  pending: () => readPendingPublications(client),
  committed: () => readCommittedPublicationHeads(client),
  acknowledge: (e, h) => acknowledgePublication(client, e, h)
})
async function saveEvidence(f, name, checks) {
  if (!process.env.PUBLICATION_EVIDENCE_DIR) return
  const directory = join(process.env.PUBLICATION_EVIDENCE_DIR, name)
  await mkdir(process.env.PUBLICATION_EVIDENCE_DIR, { recursive: true, mode: 0o700 })
  // Evidence runs require a fresh destination; never overwrite a previous run.
  await mkdir(directory, { mode: 0o700 })
  await copyFile(f.options.publicKeyFile, join(directory, 'pinned-public-key.pem'))
  for (const folder of await readdir(f.options.directory)) {
    if (!folder.startsWith('checkpoint-')) continue
    const target = join(directory, folder)
    await mkdir(target, { mode: 0o700 })
    for (const file of ['checkpoint.json', 'records.enc'])
      await copyFile(join(f.options.directory, folder, file), join(target, file))
  }
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify(
      {
        version: 1,
        environmentId: f.options.environmentId,
        configurationVersion: f.options.configurationVersion,
        ...checks,
        realIndependentCustody: false,
        targetsMet: false
      },
      null,
      2
    ) + '\n',
    { mode: 0o600 }
  )
}
async function fixture(t) {
  const db = await isolatedLedger(),
    root = await mkdtemp(join(tmpdir(), 't10-pipeline-'))
  t.after(async () => {
    await db.close()
    await rm(root, { recursive: true, force: true })
  })
  const witnessDirectory = join(root, 'witness'),
    directory = join(root, 'custody')
  await mkdir(witnessDirectory, { mode: 0o700 })
  await mkdir(directory, { mode: 0o700 })
  const pair = generateKeyPairSync('ed25519'),
    publicKeyFile = join(root, 'pin.pem'),
    privateKeyFile = join(root, 'authority.pem')
  await writeFile(publicKeyFile, pair.publicKey.export({ format: 'pem', type: 'spki' }), {
    mode: 0o600
  })
  await writeFile(privateKeyFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    mode: 0o600
  })
  const options = {
      directory,
      publicKeyFile,
      privateKeyFile,
      encryptionKey: randomBytes(32),
      environmentId: 'pipeline-local',
      configurationVersion: 'test-config-v4'
    },
    store = new LocalCheckpointPublicationStore(options)
  const witness = new LedgerWitness(db.client, db.id, witnessDirectory, 'wallet', undefined, {
    environmentId: options.environmentId
  })
  await witness.initializeFresh()
  return {
    ...db,
    root,
    witnessDirectory,
    options,
    store,
    witness,
    worker: new PublicationWorker({ source: source(db.client), store })
  }
}
if (childMode)
  process.once('message', async (m) => {
    const db = await connect(new URL(m.url)),
      options = { ...m.options, encryptionKey: Buffer.from(m.keyHex, 'hex') }
    const s = source(db.client)
    s.acknowledge = async () => {
      process.send({ stage: 'persisted-before-ack' })
      await new Promise(() => {})
    }
    await new PublicationWorker({
      source: s,
      store: new LocalCheckpointPublicationStore(options)
    }).reconcile()
  })
test('actual publisher SIGKILL after custody commit before receipt: restart reads exact checkpoint and acknowledges once', async (t) => {
  const f = await fixture(t)
  await f.worker.reconcile()
  await f.witness.run(
    (tx) =>
      tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId","address","bindingVersion") VALUES (${randomUUID()}::uuid,31337,${'0x' + '1'.repeat(40)},1)`
  )
  const child = fork(new URL('./publication-pipeline.integration.mjs', import.meta.url), [], {
    env: { PATH: process.env.PATH, T10_PUBLICATION_CHILD: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  })
  t.after(() => {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL')
  })
  const reached = new Promise((resolve, reject) => {
    child.once('message', (m) =>
      m.stage === 'persisted-before-ack' ? resolve() : reject(new Error('unexpected stage'))
    )
    child.once('error', reject)
    child.once('exit', () => reject(new Error('early exit')))
  })
  child.send({
    url: f.url.toString(),
    options: { ...f.options, encryptionKey: undefined },
    keyHex: f.options.encryptionKey.toString('hex')
  })
  await reached
  const before = await f.store.recover(),
    hash = before.receipts.at(-1).checkpointHash
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
  assert.equal((await readPendingPublications(f.client)).length, 1)
  await new PublicationWorker({
    source: source(f.client),
    store: new LocalCheckpointPublicationStore(f.options)
  }).reconcile()
  assert.equal((await readPendingPublications(f.client)).length, 0)
  const after = await f.store.recover()
  assert.equal(after.entries.length, 2)
  assert.equal(after.receipts.at(-1).checkpointHash, hash)
  await f.witness.verify()
  await saveEvidence(f, 'ack-loss-sigkill', {
    checkpointHash: hash,
    checkpointCount: after.entries.length,
    pendingAfterRestart: 0,
    actualProcessKill: true
  })
})
test('committed but unsent wallet and refund records are recovered in full; old acknowledged projection remains isolated', async (t) => {
  const f = await fixture(t)
  await f.worker.reconcile()
  const accountId = randomUUID(),
    intent = randomUUID(),
    order = randomUUID(),
    listing = randomUUID(),
    hash = (c) => '0x' + c.repeat(64)
  await f.witness.run(async (tx) => {
    await tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId","address","bindingVersion") VALUES (${accountId}::uuid,31337,${'0x' + '2'.repeat(40)},2)`
    await tx.$executeRaw`INSERT INTO "PaymentLedgerIntent" ("id","orderId","listingId","stockId","scope","digest","termsHash","recoveryEpoch","permit") VALUES (${intent}::uuid,${order}::uuid,${listing}::uuid,${hash('1')},'test',${hash('2')},${hash('3')},${f.epoch}::uuid,'{}'::jsonb)`
    await tx.$executeRaw`INSERT INTO "PaymentLedgerRefundExit" ("scope","chainId","escrow","chainOrderId","orderId","listingId","stockId","generation","nextGeneration","fundedIntentId","recoveryEpoch","basisHash","evidence","refundHeight","refundBlockHash","refundTxHash","refundLogIndex","finalizedHeight","finalizedHash","neverRegistered") VALUES ('test',31337,${'0x' + '1'.repeat(40)},${hash('4')},${order}::uuid,${listing}::uuid,${hash('1')},'0','1',${intent}::uuid,${f.epoch}::uuid,${'a'.repeat(64)},'{}'::jsonb,12,${hash('5')},${hash('6')},0,20,${hash('7')},true)`
  })
  assert.equal((await readPendingPublications(f.client)).length, 1)
  await f.worker.reconcile()
  const recovered = await f.store.recover(),
    last = recovered.entries.at(-1)
  assert.equal(JSON.parse(last.records.WalletLedgerAccount[0]).address, '0x' + '2'.repeat(40))
  assert.equal(JSON.parse(last.records.PaymentLedgerRefundExit[0]).orderId, order)
  assert.equal(
    last.digest,
    JSON.parse(await readFile(join(f.witnessDirectory, 'head.json'), 'utf8')).digest
  )
  // Simulate old outbox recovery (not a chain rollback): custody is still newer.
  await f.client.$executeRaw`DELETE FROM "LedgerPublicationReceipt" WHERE "sequence"=1`
  await f.client.$executeRaw`DELETE FROM "LedgerPublicationOutbox" WHERE "sequence"=1`
  await assert.rejects(f.worker.reconcile(), /PUBLICATION_ROLLBACK/)
  await assert.rejects(f.witness.verify(), /WALLET_UNAVAILABLE/)
  assert.equal((await f.worker.status()).state, 'isolated')
  await saveEvidence(f, 'wallet-refund-gap', {
    checkpointHash: recovered.receipts.at(-1).checkpointHash,
    walletAddressRecovered: true,
    refundOrderId: order,
    refundRecordRecovered: true,
    identityState: 'isolated',
    witnessDenied: true,
    chainEventsReplayed: false
  })
})

test('wallet and authorization consumption share one signed vector and both reconcile after new wallet changes', async (t) => {
  const f = await fixture(t)
  await f.worker.reconcile()
  const directory = join(f.root, 'authorization-journal'),
    usedDirectory = join(f.root, 'local-receipts')
  await mkdir(directory, { mode: 0o700 })
  await mkdir(usedDirectory, { mode: 0o700 })
  const receipt = {
    nonce: randomUUID(),
    authorizationHash: 'a'.repeat(64),
    recoveryId: randomUUID(),
    checkpointHash: 'b'.repeat(64),
    configurationVersion: f.options.configurationVersion,
    consumedAt: new Date().toISOString()
  }
  const journal = new LocalRecoveryAuthorizationJournal({
    directory,
    usedDirectory,
    binding: {
      environmentId: f.options.environmentId,
      recoveryId: receipt.recoveryId,
      checkpointHash: receipt.checkpointHash,
      configurationVersion: receipt.configurationVersion
    }
  })
  const guard = new PublishedRecoveryConsumptionGuard({ journal, store: f.store })
  await guard.consume(receipt)
  const worker = new PublicationWorker({
    source: combinePublicationSources([source(f.client), guard.source()]),
    store: f.store
  })
  await worker.reconcile()
  await f.witness.run(
    (tx) =>
      tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId","chainId") VALUES (${randomUUID()}::uuid,31337)`
  )
  await worker.reconcile()
  const material = await f.store.recover()
  assert.equal(material.entries.length, 3)
  assert.equal(material.receipts.at(-1).checkpoint.ledgers.length, 2)
  assert.equal((await worker.status()).state, 'confirmed')
  await assert.rejects(guard.consume(receipt), /CONSUMED/)
  await saveEvidence(f, 'combined-authorization-vector', {
    checkpointHash: material.receipts.at(-1).checkpointHash,
    checkpointCount: material.entries.length,
    streamCount: 2,
    consumedAuthorizationReplayDenied: true
  })
})
