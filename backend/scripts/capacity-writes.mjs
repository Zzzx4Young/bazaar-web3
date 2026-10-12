import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { capacityHttpError } from './capacity-diagnostics.mjs'

export const capacityWritePolicy = { maxAttempts: 3, retryDelayMs: 50 }

// Each buyer completes create, create replay, cancel, cancel replay in successive rounds.
// Arrival scheduling stays in the caller: a slow phase fails rather than reducing offered load.
export function capacityWrites(post, physicalListings) {
  const buyers = new Map(), expectedOrders = new Map()
  const stats = { created: 0, createReplays: 0, cancelled: 0, cancelReplays: 0 }
  const recovery = { retryAttempts: 0, recoveredRequests: 0, failedRequests: 0, transientFailures: {} }
  const retryCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'])
  async function submit(path, payload, user, key) {
    // Client recovery only: repeat an ambiguous write with exactly the original key/body.
    for (let attempt = 0; attempt < capacityWritePolicy.maxAttempts; attempt++) {
      let response, failure
      try {
        response = await post(path, payload, user, key)
        if (![502, 503, 504].includes(response.status)) {
          if (attempt && response.status === 200) recovery.recoveredRequests++
          if (response.status !== 200) recovery.failedRequests++
          return response
        }
        failure = `HTTP_${response.status}`
      } catch (error) {
        if (!retryCodes.has(error.code)) { recovery.failedRequests++; throw error }
        failure = error.code
      }
      recovery.transientFailures[failure] = (recovery.transientFailures[failure] ?? 0) + 1
      if (attempt === capacityWritePolicy.maxAttempts - 1) {
        recovery.failedRequests++
        const error = new Error('Write recovery exhausted')
        error.code = failure
        if (response) {
          const diagnostic = capacityHttpError(response, 'Write recovery exhausted')
          error.responseCode = diagnostic.responseCode
          error.apiIndex = diagnostic.apiIndex
        }
        throw error
      }
      recovery.retryAttempts++
      await new Promise(resolve => setTimeout(resolve, capacityWritePolicy.retryDelayMs))
    }
  }
  async function send(round, user, userIndex) {
    const phase = round % 4
    let state = buyers.get(user.id)
    if (state?.busy) {
      const error = new Error('Write phase still in flight')
      error.code = 'WRITE_PHASE_IN_FLIGHT'
      throw error
    }
    if ((phase === 0 && state && state.round !== round - 1) ||
      (phase !== 0 && state?.round !== round - 1)) {
      const error = new Error('Previous write phase did not complete successfully')
      error.code = 'WRITE_PREVIOUS_PHASE_FAILED'
      throw error
    }
    if (phase === 0) {
      assert.ok(!state || state.round === round - 1)
      state = { listing: physicalListings[userIndex], createKey: randomUUID(), cancelKey: randomUUID(), round: round - 1 }
      assert.ok(state.listing)
      buyers.set(user.id, state)
    }
    assert.equal(state?.round, round - 1)
    state.busy = true
    try {
      const create = phase < 2
      const payload = create ? { listingId: state.listing.id, version: 1,
        shipping: { recipient: 'Capacity buyer', contact: 'Isolated fixture', address: 'Capacity test address' } } : {}
      const path = create ? '/api/orders' : `/api/orders/${state.orderId}/actions/cancel`
      const response = await submit(path, payload, user, create ? state.createKey : state.cancelKey)
      if (response.status !== 200) {
        throw capacityHttpError(response, 'Write response failed')
      }
      if (phase === 0) {
        assert.equal(typeof response.value.orderId, 'string')
        assert.ok(!expectedOrders.has(response.value.orderId))
        state.orderId = response.value.orderId
        expectedOrders.set(state.orderId, { buyerId: user.id, listingId: state.listing.id, cancelled: false })
        stats.created++
      } else {
        assert.equal(response.value.orderId, state.orderId)
        if (phase === 1) stats.createReplays++
        if (phase === 2) { expectedOrders.get(state.orderId).cancelled = true; stats.cancelled++ }
        if (phase === 3) stats.cancelReplays++
      }
      state.round = round
    } finally { state.busy = false }
  }

  async function audit(client) {
    const listingIds = [...buyers.values()].map(state => state.listing.id)
    const orders = await client.order.findMany({ where: { listingId: { in: listingIds } },
      include: { snapshot: true, shipping: true, reservationOrderRows: true,
        eventOrderRows: true, idempotencyOrderRows: true } })
    assert.equal(orders.length, expectedOrders.size, 'Unexpected or missing persisted orders')
    for (const order of orders) {
      const expected = expectedOrders.get(order.id)
      assert.ok(expected, 'Unacknowledged extra order')
      assert.equal(order.buyerId, expected.buyerId)
      assert.equal(order.listingId, expected.listingId)
      assert.equal(order.status, expected.cancelled ? 'cancelled' : 'pending_payment')
      assert.equal(order.version, expected.cancelled ? 2 : 1)
      assert.equal(order.snapshot.priceAmount.toFixed(), '10')
      assert.equal(order.snapshot.currency, 'USD')
      assert.equal(order.shipping.address, 'Capacity test address')
      assert.equal(order.reservationOrderRows.length, 1)
      assert.equal(order.reservationOrderRows[0].state, expected.cancelled ? 'cancelled' : 'active')
      assert.equal(order.eventOrderRows.length, expected.cancelled ? 2 : 1)
      assert.equal(order.eventOrderRows.filter(event => event.operation === 'create').length, 1)
      assert.equal(order.eventOrderRows.filter(event => event.operation === 'cancel').length, expected.cancelled ? 1 : 0)
      assert.equal(order.idempotencyOrderRows.length, expected.cancelled ? 2 : 1)
    }
    const inventory = await client.physicalInventory.findMany({ where: { listingId: { in: listingIds } } })
    assert.equal(inventory.length, buyers.size)
    for (const item of inventory) {
      const ordersForItem = orders.filter(order => order.listingId === item.listingId)
      const active = ordersForItem.filter(order => order.status === 'pending_payment')
      assert.ok(active.length <= 1, 'Multiple active orders reserved one physical item')
      assert.equal(item.activeOrderId, active[0]?.id ?? null)
      assert.equal(item.availability, active.length ? 'reserved' : 'available')
      const cancelled = ordersForItem.filter(order => order.status === 'cancelled').length
      assert.equal(item.version, 1 + ordersForItem.length + cancelled)
    }
    return { ...stats, verifiedOrders: orders.length, verifiedPhysicalItems: inventory.length,
      activeReservations: stats.created - stats.cancelled, duplicateOrders: 0, duplicateEvents: 0 }
  }
  return { send, audit, stats, recovery }
}
