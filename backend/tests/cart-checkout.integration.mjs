import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { OrderCommands } from '../dist/orders/order-commands.js'
import { fixture, sandbox, shipping } from './helpers/database.mjs'

let db, commands
before(async () => { db = await sandbox(); commands = new OrderCommands(db.client) })
after(async () => { await db?.close() })

test('cart creates independent multi-seller orders atomically and replays once', async () => {
  const a = await fixture(db)
  const b = await fixture(db, 'digital', '0.00012345')
  await db.client.listing.update({ where: { id: b.listing.id }, data: { currency: 'BTC' } })
  const items = [a.input, { listingId: b.listing.id, version: 1 }]
  const key = randomUUID()
  const first = await commands.createCheckout(a.buyer, key, items)
  const replay = await commands.createCheckout(a.buyer, key, items)
  assert.deepEqual(replay, first)
  assert.equal(first.orderIds.length, 2)
  const checkout = await db.client.checkout.findUniqueOrThrow({
    where: { id: first.checkoutId }, include: { orders: { include: { snapshot: true } } }
  })
  assert.equal(checkout.buyerId, a.buyer)
  assert.deepEqual(new Set(checkout.orders.map((order) => order.sellerId)),
    new Set([a.seller, b.seller]))
  assert.deepEqual(new Set(checkout.orders.map((order) => order.snapshot.currency)),
    new Set(['TEST', 'BTC']))
  assert.equal((await db.client.physicalInventory.findUniqueOrThrow({ where: { listingId: a.listing.id } })).availability, 'reserved')
  await db.market.act(a.buyer, randomUUID(), first.orderIds[1], 'pay')
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: first.orderIds[0] } })).status,
    'pending_payment')
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: first.orderIds[1] } })).status,
    'pending_delivery')
  assert.equal((await db.client.settlementRecord.findFirstOrThrow({
    where: { orderId: first.orderIds[1], operation: 'payment' }
  })).currency, 'BTC')
  await assert.rejects(commands.createCheckout(a.buyer, key, [...items].reverse()),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT')
  assert.equal(await db.client.order.count({ where: { checkoutId: first.checkoutId } }), 2)
})

test('unavailable cart line rolls back every reservation and checkout', async () => {
  const free = await fixture(db)
  const locked = await fixture(db)
  await db.market.create(locked.buyer, randomUUID(), locked.input)
  const before = await db.client.checkout.count()
  await assert.rejects(commands.createCheckout(free.buyer, randomUUID(), [
    free.input, { listingId: locked.listing.id, version: 1, shipping }
  ]), (error) => error.code === 'UNAVAILABLE')
  assert.equal(await db.client.checkout.count(), before)
  assert.equal(await db.client.order.count({ where: { listingId: free.listing.id } }), 0)
  assert.equal((await db.client.physicalInventory.findUniqueOrThrow({ where: { listingId: free.listing.id } })).availability, 'available')
})

test('competing carts cannot reserve the same physical stock twice', async () => {
  const a = await fixture(db)
  const b = await fixture(db)
  const secondBuyer = await db.client.account.create({
    data: { loginName: randomUUID(), displayName: 'Cart rival' }
  })
  const items = [a.input, b.input]
  const attempts = await Promise.allSettled([
    commands.createCheckout(a.buyer, randomUUID(), items),
    commands.createCheckout(secondBuyer.id, randomUUID(), items)
  ])
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1)
  assert.equal(await db.client.order.count({ where: { listingId: { in: [a.listing.id, b.listing.id] } } }), 2)
  const orders = await db.client.order.findMany({ where: { listingId: { in: [a.listing.id, b.listing.id] } } })
  assert.equal(new Set(orders.map((order) => order.checkoutId)).size, 1)
})
