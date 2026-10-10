import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityOutageWrites } from '../scripts/capacity-outage-writes.mjs'

const users = Array.from({ length: 10 }, (_, index) => ({ id: `buyer-${index}` }))
const listings = Array.from({ length: 8 }, (_, index) => ({ id: `physical-${index}` }))

test('outage plan sends every scheduled write despite an unresolved earlier request', async () => {
  const calls = []
  let release
  const workload = capacityOutageWrites(
    async (...args) => {
      calls.push(args)
      if (calls.length === 1)
        return new Promise((resolve) => {
          release = resolve
        })
      return { status: 200, value: { orderId: 'same-order' } }
    },
    users,
    listings,
    20
  )
  await workload.prepare()
  const first = workload.send(8)
  await workload.send(18)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], calls[0])
  release({ status: 200, value: { orderId: 'same-order' } })
  await first
  assert.equal(workload.summary().acknowledgedArrivals, 2)
})

test('ambiguous create and failed cancellation reconcile original bodies and keys', async () => {
  const calls = []
  let unavailable = false
  const workload = capacityOutageWrites(
    async (...args) => {
      calls.push(args)
      return unavailable
        ? { status: 503, value: { code: 'DATABASE_UNAVAILABLE' } }
        : {
            status: 200,
            value: {
              orderId: args[0].includes('/actions/') ? args[0].split('/')[3] : args[1].listingId
            }
          }
    },
    users,
    listings,
    40
  )
  await workload.prepare()
  assert.equal(calls.length, 2, 'Cancellation targets are acknowledged before load')
  unavailable = true
  for (const index of [8, 9, 18, 19, 28, 29, 38, 39])
    await assert.rejects(workload.send(index), { code: 'HTTP_503' })
  assert.equal(calls.length, 10, 'Every planned arrival actually reaches transport')
  const loadCalls = calls.slice(2)
  unavailable = false
  await workload.reconcile()
  assert.deepEqual(calls[10], loadCalls[0])
  assert.deepEqual(calls[12], loadCalls[4])
  assert.equal(workload.summary().acknowledgedArrivals, 0)
  assert.equal(workload.summary().reconciledOperations, 4)
  assert.equal(workload.summary().attemptedArrivals, 8)
})

test('outage plan rejects changed replay identities and duplicate arrivals', async () => {
  let sequence = 0
  const workload = capacityOutageWrites(
    async () => ({ status: 200, value: { orderId: `order-${++sequence}` } }),
    users,
    listings,
    20
  )
  await workload.prepare()
  await workload.send(8)
  await assert.rejects(workload.send(18), /Replay changed order identity/)
  await assert.rejects(workload.send(8), /Arrival already attempted/)
})

test('500 requests per second retains 20% writes and rejects insufficient inventory', async () => {
  const fullUsers = Array.from({ length: 1000 }, (_, index) => ({ id: `buyer-${index}` }))
  const fullListings = Array.from({ length: 5000 }, (_, index) => ({ id: `physical-${index}` }))
  const workload = capacityOutageWrites(
    async () => {
      throw new Error('No HTTP before preparation')
    },
    fullUsers,
    fullListings,
    30000
  )
  assert.deepEqual(workload.summary().planned, {
    creates: 1600,
    createReplays: 1600,
    cancels: 1400,
    cancelReplays: 1400,
    operations: 3000,
    writeArrivals: 6000,
    physicalItems: 3000
  })
  assert.throws(
    () => capacityOutageWrites(() => {}, fullUsers, fullListings, 150000),
    /Insufficient physical inventory/
  )
})

test('reconciliation cannot race in-flight arrivals or hide an unissued arrival', async () => {
  let release,
    delayed = false
  const workload = capacityOutageWrites(
    async (_path, payload) => {
      if (payload.listingId === 'physical-0' && !delayed) {
        delayed = true
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return { status: 200, value: { orderId: payload.listingId } }
    },
    users,
    listings,
    10
  )
  await workload.prepare()
  await assert.rejects(workload.reconcile(), /Missing scheduled HTTP write arrivals/)
  const pending = workload.send(8)
  await workload.send(9)
  await assert.rejects(workload.reconcile(), /Wait for in-flight arrivals/)
  release({ status: 200, value: { orderId: 'physical-0' } })
  await pending
})

test('retrying a partial drain does not double-count reconciled operations', async () => {
  let unavailable = false
  const workload = capacityOutageWrites(
    async (_path, payload) =>
      unavailable && payload.listingId === 'physical-1'
        ? { status: 503, value: {} }
        : { status: 200, value: { orderId: payload.listingId } },
    users,
    listings,
    20
  )
  await workload.prepare()
  for (const index of [8, 9, 18, 19]) await workload.send(index)
  unavailable = true
  await assert.rejects(workload.reconcile(), { code: 'HTTP_503' })
  unavailable = false
  await workload.reconcile()
  assert.equal(workload.summary().reconciledOperations, 2)
})

test('direct original API probe retains the prepared create key and body without creating another order', async () => {
  const calls = []
  const workload = capacityOutageWrites(async (...args) => { calls.push(args)
    return { status: 200, value: { orderId: args[1].listingId } }
  }, users, listings, 40)
  assert.throws(() => workload.originalReplayProbe())
  await workload.prepare()
  const probe = workload.originalReplayProbe()
  let request
  const response = await probe.request(async (...args) => { request = args
    return { status: 200, value: { orderId: probe.orderId } }
  })
  assert.deepEqual(request, calls[0])
  assert.equal(response.value.orderId, calls[0][1].listingId)
})
