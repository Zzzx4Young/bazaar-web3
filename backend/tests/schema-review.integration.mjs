import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, after, test } from 'node:test'
import { sandbox, fixture, issueOrder } from './helpers/database.mjs'

let db
before(async () => {
  db = await sandbox()
})
after(async () => {
  await db?.close()
})
const check = (error) =>
  error.meta?.driverAdapterError?.cause?.originalCode === '23514' || error.meta?.code === '23514'

test('review R1: positive prices must also reject PostgreSQL numeric NaN', async () => {
  const f = await fixture(db)
  await assert.rejects(
    db.client
      .$executeRaw`UPDATE "Listing" SET "priceAmount" = 'NaN'::numeric WHERE "id" = ${f.listing.id}::uuid`,
    check
  )
  await db.read(async (client) =>
    assert.equal(
      (await client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).priceAmount.toFixed(
        18
      ),
      f.listing.priceAmount.toFixed(18)
    )
  )
})

test('review R2: order participants and product type cannot change after creation', async () => {
  const f = await fixture(db, 'digital'),
    id = await db.market.create(f.buyer, randomUUID(), f.input)
  await assert.rejects(
    db.client.$executeRaw`UPDATE "Order" SET "buyerId" = ${f.other}::uuid WHERE "id" = ${id}::uuid`,
    check
  )
  await assert.rejects(
    db.client
      .$executeRaw`UPDATE "Listing" SET "type" = 'physical' WHERE "id" = ${f.listing.id}::uuid`,
    check
  )
})

test('review R3: shipping is immutable historical data', async () => {
  const f = await fixture(db),
    id = await db.market.create(f.buyer, randomUUID(), f.input)
  await assert.rejects(
    db.client
      .$executeRaw`UPDATE "OrderShipping" SET "recipient" = 'replaced' WHERE "orderId" = ${id}::uuid`,
    check
  )
})

test('review R4: delivery, issues and refund approval reference the order participants', async () => {
  const f = await fixture(db),
    id = await issueOrder(db, f)
  await assert.rejects(
    db.client.deliveryRecord.create({
      data: { orderId: id, sellerId: f.other, sequence: 2, kind: 'physical', reference: 'forged' }
    }),
    (e) => e.code === 'P2003'
  )
  await assert.rejects(
    db.client.issueRecord.create({
      data: {
        orderId: id,
        buyerId: f.other,
        sourceStatus: 'pending_delivery',
        description: 'forged',
        status: 'resolved',
        resolvedAt: new Date()
      }
    }),
    (e) => e.code === 'P2003'
  )
  const request = await db.client.refundRequest.findFirstOrThrow({ where: { orderId: id } })
  await assert.rejects(
    db.client.refundRequest.update({
      where: { id: request.id },
      data: {
        approvedBy: f.other,
        status: 'approved',
        approvedAt: new Date(),
        returnOutcome: 'returned'
      }
    }),
    (e) => e.code === 'P2003'
  )
})

test('C1 service rejects over-scale amounts and unknown actions without side effects', async () => {
  const f = await fixture(db),
    id = await db.market.create(f.buyer, randomUUID(), f.input)
  await assert.rejects(
    db.market.edit(f.seller, f.listing.id, 1, { priceAmount: '1.1234567890123456789' }),
    (e) => e.code === 'INVALID_AMOUNT'
  )
  await assert.rejects(
    db.market.act(f.buyer, randomUUID(), id, 'unknown_action'),
    (e) => e.code === 'INVALID_INPUT'
  )
  await db.read(async (client) => {
    assert.equal(
      (await client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).version,
      1
    )
    assert.equal(await client.orderEvent.count({ where: { orderId: id } }), 1)
    const order = await client.order.findUniqueOrThrow({
      where: { id },
      include: { snapshot: true, shipping: true }
    })
    assert.equal(order.snapshot.title, 'Version one')
    assert.equal(order.shipping.recipient, f.input.shipping.recipient)
  })
})
