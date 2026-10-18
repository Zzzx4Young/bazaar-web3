import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { sandbox, fixture } from './helpers/database.mjs'

test('completion records a stable clock while cancellation and refund never start archival', async () => {
  const db = await sandbox()
  try {
    const completed = await fixture(db, 'digital', '11')
    const completeId = await db.market.create(completed.buyer, randomUUID(), completed.input)
    await db.market.act(completed.buyer, randomUUID(), completeId, 'pay')
    await db.market.act(completed.seller, randomUUID(), completeId, 'deliver', { reference: 'https://example.com/delivery' })
    await db.market.act(completed.buyer, randomUUID(), completeId, 'accept')
    const firstClock = (await db.client.order.findUniqueOrThrow({ where: { id: completeId } })).completedAt
    assert.ok(firstClock instanceof Date)
    assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: completeId } })).completedAt?.getTime(), firstClock.getTime())

    const cancelled = await fixture(db, 'physical', '8')
    const cancelId = await db.market.create(cancelled.buyer, randomUUID(), cancelled.input)
    await db.market.act(cancelled.buyer, randomUUID(), cancelId, 'cancel')
    assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: cancelId } })).completedAt, null)

    const refunded = await fixture(db, 'digital', '7')
    const refundId = await db.market.create(refunded.buyer, randomUUID(), refunded.input)
    await db.market.act(refunded.buyer, randomUUID(), refundId, 'pay')
    await db.market.act(refunded.seller, randomUUID(), refundId, 'deliver', { reference: 'https://example.com/delivery' })
    await db.market.act(refunded.buyer, randomUUID(), refundId, 'issue', { description: 'Wrong item' })
    await db.market.act(refunded.buyer, randomUUID(), refundId, 'request_refund')
    await db.market.act(refunded.seller, randomUUID(), refundId, 'refund')
    assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: refundId } })).completedAt, null)
  } finally {
    await db.close()
  }
})
