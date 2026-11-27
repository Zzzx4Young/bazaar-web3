import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const m = await import('../dist/auth/publication-worker.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
function fixture() {
  const id = randomUUID(),
    entry = {
      version: 1,
      environmentId: 'local',
      namespace: 'wallet',
      ledgerId: id,
      sequence: 0,
      digest: 'a'.repeat(64),
      records: { Meta: ['{}'] }
    },
    position = { namespace: 'wallet', ledgerId: id, sequence: 0, digest: entry.digest }
  let pending = [entry],
    confirmed = [],
    acks = 0,
    fail = false
  const source = {
    pending: async () => pending,
    committed: async () => [position],
    acknowledge: async () => {
      acks++
      if (fail) throw new Error('ACK_LOST')
      pending = []
    }
  }
  const store = {
    recover: async () => ({
      entries: confirmed,
      receipts: confirmed.map(() => ({
        checkpointHash: 'b'.repeat(64),
        checkpoint: { ledgers: [position] }
      }))
    }),
    publish: async (e) => {
      if (!confirmed.length) confirmed.push(e)
      return { checkpointHash: 'b'.repeat(64), checkpoint: { ledgers: [position] } }
    }
  }
  return {
    source,
    store,
    entry,
    position,
    get acks() {
      return acks
    },
    failAck(v) {
      fail = v
    },
    get confirmed() {
      return confirmed
    },
    clearCustody() {
      confirmed = []
    }
  }
}
test('worker starts with durable drain; lost acknowledgement retries without advancing custody twice', async () => {
  assert.equal(typeof m.PublicationWorker, 'function')
  const f = fixture(),
    w = new m.PublicationWorker({ source: f.source, store: f.store })
  f.failAck(true)
  await assert.rejects(w.reconcile(), /ACK_LOST/)
  assert.equal(f.confirmed.length, 1)
  f.failAck(false)
  await new m.PublicationWorker({ source: f.source, store: f.store }).reconcile()
  assert.equal(f.confirmed.length, 1)
  assert.equal(f.acks, 2)
  assert.equal((await w.status()).state, 'confirmed')
})
test('missing acknowledged recovery material or committed sequence lag remains isolated', async () => {
  assert.equal(typeof m.PublicationWorker, 'function')
  const f = fixture(),
    w = new m.PublicationWorker({ source: f.source, store: f.store })
  await w.reconcile()
  f.clearCustody()
  await assert.rejects(w.reconcile(), /PUBLICATION_INCOMPLETE/)
  assert.equal((await w.status()).state, 'isolated')
  const g = fixture()
  await g.store.publish(g.entry)
  g.source.committed = async () => [{ ...g.position, sequence: -1 }]
  await assert.rejects(
    new m.PublicationWorker({ source: g.source, store: g.store }).reconcile(),
    /PUBLICATION_ROLLBACK/
  )
})
test('60-second reconciliation and immediate wakes coalesce; stop clears scheduled work', async () => {
  assert.equal(typeof m.PublicationWorker, 'function')
  const f = fixture(),
    scheduled = [],
    cleared = []
  const w = new m.PublicationWorker({
    source: f.source,
    store: f.store,
    scheduler: {
      every: (fn, ms) => {
        scheduled.push({ fn, ms })
        return 7
      },
      clear: (id) => cleared.push(id)
    }
  })
  await w.start()
  assert.equal(scheduled[0].ms, 60000)
  await Promise.all([w.notify(), w.notify()])
  await scheduled[0].fn()
  await w.stop()
  assert.deepEqual(cleared, [7])
  assert.equal(f.acks, 1)
})
test('refund-only rebuild does not clear missing wallet record isolation', async () => {
  assert.equal(typeof m.PublicationWorker, 'function')
  const f = fixture(),
    wallet = { ...f.position, sequence: 2 },
    refund = {
      namespace: 'private-files',
      ledgerId: randomUUID(),
      sequence: 0,
      digest: 'c'.repeat(64)
    }
  f.source.committed = async () => [wallet, refund]
  await assert.rejects(
    new m.PublicationWorker({ source: f.source, store: f.store }).reconcile(),
    /PUBLICATION_INCOMPLETE/
  )
})
test('lost acknowledgement is not reported confirmed before durable source receipt', async () => {
  const f = fixture(),
    w = new m.PublicationWorker({ source: f.source, store: f.store })
  f.failAck(true)
  await assert.rejects(w.reconcile(), /ACK_LOST/)
  assert.equal((await w.status()).state, 'isolated')
})
test('C2 alone or refund-only rebuild cannot prove missing offchain wallet history complete', async () => {
  const f = fixture(),
    w = new m.PublicationWorker({
      source: f.source,
      store: f.store,
      offchainHistoryVerified: async () => false
    })
  await assert.rejects(w.reconcile(), /PUBLICATION_OFFCHAIN_HISTORY_UNPROVEN/)
  assert.equal((await w.status()).state, 'isolated')
  assert.equal(f.acks, 0)
})
test('combined ledger and consumed-grant sources reconcile the shared checkpoint vector without conflating permissions', async () => {
  assert.equal(typeof m.combinePublicationSources, 'function')
  const a = fixture(),
    b = fixture()
  b.entry.namespace = 'recovery-authorizations'
  b.position.namespace = 'recovery-authorizations'
  const combined = m.combinePublicationSources([a.source, b.source])
  assert.equal((await combined.committed()).length, 2)
  await combined.acknowledge(a.entry, 'b'.repeat(64))
  assert.equal(a.acks, 1)
  assert.equal(b.acks, 0)
  await combined.acknowledge(b.entry, 'b'.repeat(64))
  assert.equal(b.acks, 1)
  const ambiguous = m.combinePublicationSources([a.source, a.source])
  await assert.rejects(ambiguous.committed(), /PUBLICATION_SOURCE_CONFLICT/)
})
