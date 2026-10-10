import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const requestMixSize = 10
const firstWriteKind = 8
const writeCycleRounds = 4

// A separate fault workload: creates and cancellations target distinct physical items.
// No scheduled arrival depends on the response to an earlier arrival. The ordinary
// capacity workload continues to exercise the sequential lifecycle of one order.
export function capacityOutageWrites(post, users, physicalListings, arrivals) {
  assert.ok(users.length > 0 && users.length % requestMixSize === 0, 'Invalid buyer population')
  assert.ok(Number.isSafeInteger(arrivals) && arrivals > 0, 'Invalid arrival count')
  assert.equal(new Set(users.map((user) => user.id)).size, users.length, 'Duplicate buyers')
  assert.equal(
    new Set(physicalListings.map((item) => item.id)).size,
    physicalListings.length,
    'Duplicate inventory'
  )
  const operations = new Map(),
    plan = new Map(),
    attempted = new Set()
  const planned = {
    creates: 0,
    createReplays: 0,
    cancels: 0,
    cancelReplays: 0,
    operations: 0,
    writeArrivals: 0,
    physicalItems: 0
  }
  let prepared = false,
    reconciled = false,
    reconciling = false,
    inFlight = 0,
    acknowledgedArrivals = 0,
    reconciledOperations = 0
  for (let index = 0; index < arrivals; index++) {
    if (index % requestMixSize < firstWriteKind) continue
    const userIndex = index % users.length
    const round = Math.floor(index / users.length)
    const phase = round % writeCycleRounds
    const create = phase < 2
    const identity = `${Math.floor(round / writeCycleRounds)}:${userIndex}:${create}`
    let operation = operations.get(identity)
    if (!operation) {
      const listing = physicalListings[operations.size]
      assert.ok(listing, 'Insufficient physical inventory for independent fault workload')
      operation = {
        create,
        user: users[userIndex],
        key: randomUUID(),
        listing,
        payload: {
          listingId: listing.id,
          version: 1,
          shipping: {
            recipient: 'Capacity buyer',
            contact: 'Isolated fixture',
            address: 'Capacity test address'
          }
        }
      }
      operations.set(identity, operation)
    }
    plan.set(index, operation)
    planned[['creates', 'createReplays', 'cancels', 'cancelReplays'][phase]]++
  }
  planned.operations = planned.physicalItems = operations.size
  planned.writeArrivals = plan.size

  function check(response, operation) {
    if (response.status !== 200) {
      const error = new Error('Fault workload write response failed')
      error.code = `HTTP_${response.status}`
      throw error
    }
    assert.equal(typeof response.value.orderId, 'string')
    if (operation.orderId)
      assert.equal(response.value.orderId, operation.orderId, 'Replay changed order identity')
    operation.orderId = response.value.orderId
  }
  async function prepare() {
    assert.ok(!prepared, 'Workload already prepared')
    // Fail the setup rather than creating an unknown cancellation target.
    for (const operation of operations.values()) {
      if (!operation.create) {
        operation.prepareKey = randomUUID()
        check(await post('/api/orders', operation.payload, operation.user, operation.prepareKey), operation)
      }
    }
    prepared = true
  }
  function submit(operation) {
    return post(
      operation.create ? '/api/orders' : `/api/orders/${operation.orderId}/actions/cancel`,
      operation.create ? operation.payload : {},
      operation.user,
      operation.key
    )
  }
  async function send(index) {
    assert.ok(prepared && !reconciled && !reconciling, 'Workload is not accepting arrivals')
    const operation = plan.get(index)
    assert.ok(operation, 'Not a planned write arrival')
    assert.ok(!attempted.has(index), 'Arrival already attempted')
    attempted.add(index)
    inFlight++
    try {
      check(await submit(operation), operation)
      acknowledgedArrivals++
    } finally {
      inFlight--
    }
  }
  async function reconcile() {
    assert.ok(prepared && !reconciled && !reconciling, 'Workload is not ready for reconciliation')
    assert.equal(attempted.size, plan.size, 'Missing scheduled HTTP write arrivals')
    assert.equal(inFlight, 0, 'Wait for in-flight arrivals before reconciliation')
    // Separate drain traffic, never counted as successful arrivals during the fault.
    // Replaying even acknowledged operations proves their original keys survived.
    reconciling = true
    try {
      for (const operation of operations.values()) {
        check(await submit(operation), operation)
        if (!operation.reconciled) {
          operation.reconciled = true
          reconciledOperations++
        }
      }
      reconciled = true
    } finally {
      reconciling = false
    }
  }
  async function audit(client) {
    assert.ok(reconciled, 'Reconcile ambiguous writes before persistence audit')
    const expected = new Map(
      [...operations.values()].map((operation) => [operation.listing.id, operation])
    )
    const orders = await client.order.findMany({
      where: { listingId: { in: [...expected.keys()] } },
      include: {
        snapshot: true,
        shipping: true,
        reservationOrderRows: true,
        eventOrderRows: true,
        idempotencyOrderRows: true
      }
    })
    assert.equal(orders.length, expected.size, 'Unexpected or missing persisted orders')
    for (const order of orders) {
      const operation = expected.get(order.listingId)
      assert.equal(order.id, operation.orderId, 'Acknowledged order was lost or replaced')
      assert.equal(order.buyerId, operation.user.id)
      assert.equal(order.status, operation.create ? 'pending_payment' : 'cancelled')
      assert.equal(order.version, operation.create ? 1 : 2)
      assert.equal(order.snapshot.priceAmount.toFixed(), '10')
      assert.equal(order.snapshot.currency, 'USD')
      assert.equal(order.snapshot.title, operation.listing.title)
      assert.equal(order.snapshot.description, operation.listing.description)
      assert.equal(order.shipping.recipient, operation.payload.shipping.recipient)
      assert.equal(order.shipping.contact, operation.payload.shipping.contact)
      assert.equal(order.shipping.address, operation.payload.shipping.address)
      assert.equal(order.reservationOrderRows.length, 1)
      assert.equal(order.reservationOrderRows[0].state, operation.create ? 'active' : 'cancelled')
      assert.equal(order.eventOrderRows.length, operation.create ? 1 : 2)
      assert.equal(order.eventOrderRows.filter((event) => event.operation === 'create').length, 1)
      assert.equal(
        order.eventOrderRows.filter((event) => event.operation === 'cancel').length,
        operation.create ? 0 : 1
      )
      assert.equal(order.idempotencyOrderRows.length, operation.create ? 1 : 2)
      assert.ok(
        order.idempotencyOrderRows.some((row) => row.key === operation.key),
        'Original idempotency key was lost'
      )
    }
    const inventory = await client.physicalInventory.findMany({
      where: { listingId: { in: [...expected.keys()] } }
    })
    assert.equal(inventory.length, expected.size)
    for (const item of inventory) {
      const operation = expected.get(item.listingId)
      assert.equal(item.activeOrderId, operation.create ? operation.orderId : null)
      assert.equal(item.availability, operation.create ? 'reserved' : 'available')
      assert.equal(item.version, operation.create ? 2 : 3)
    }
    return {
      verifiedOrders: orders.length,
      verifiedPhysicalItems: inventory.length,
      duplicateOrders: 0,
      duplicateEvents: 0
    }
  }
  return {
    prepare,
    originalReplayProbe: () => {
      assert.ok(prepared, 'Prepare original probe before gateway fault')
      const operation = [...operations.values()].find((item) => !item.create)
      assert.ok(operation?.orderId && operation.prepareKey)
      return { orderId: operation.orderId, request: (target) =>
        target('/api/orders', operation.payload, operation.user, operation.prepareKey) }
    },
    send,
    reconcile,
    audit,
    summary: () => ({
      planned: { ...planned },
      attemptedArrivals: attempted.size,
      acknowledgedArrivals,
      reconciledOperations
    })
  }
}
