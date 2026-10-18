import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { sandbox, fixture } from './helpers/database.mjs'

test('one-off listing content locks at first order and stays locked after cancellation', async () => {
  const db = await sandbox()
  try {
    const f = await fixture(db, 'physical', '15')
    assert.equal(f.listing.saleMode, 'one_off')
    await db.market.edit(f.seller, f.listing.id, 1, { title: 'Before sale' })
    const orderId = await db.market.create(f.buyer, randomUUID(), {
      ...f.input,
      version: 2
    })
    await assert.rejects(
      db.market.edit(f.seller, f.listing.id, 2, { title: 'After sale' }),
      (error) => error.code === 'LISTING_CONFLICT'
    )
    await db.market.act(f.buyer, randomUUID(), orderId, 'cancel')
    await assert.rejects(
      db.market.edit(f.seller, f.listing.id, 2, { priceAmount: '30' }),
      (error) => error.code === 'LISTING_CONFLICT'
    )
    const withdrawn = await db.market.edit(f.seller, f.listing.id, 2, {
      publicationStatus: 'withdrawn'
    })
    assert.equal(withdrawn.publicationStatus, 'withdrawn')
  } finally {
    await db.close()
  }
})

test('repeatable listing edits after order without changing old snapshot', async () => {
  const db = await sandbox()
  try {
    const f = await fixture(db, 'digital', '15')
    await db.client.listing.update({
      where: { id: f.listing.id },
      data: { saleMode: 'repeatable' }
    })
    const firstOrderId = await db.market.create(f.buyer, randomUUID(), f.input)
    const edited = await db.market.edit(f.seller, f.listing.id, 1, { title: 'Version two' })
    assert.equal(edited.title, 'Version two')
    const secondOrderId = await db.market.create(f.other, randomUUID(), {
      ...f.input,
      version: 2
    })
    assert.equal(
      (await db.client.orderSnapshot.findUniqueOrThrow({ where: { orderId: firstOrderId } })).title,
      'Version one'
    )
    assert.equal(
      (await db.client.orderSnapshot.findUniqueOrThrow({ where: { orderId: secondOrderId } })).title,
      'Version two'
    )
  } finally {
    await db.close()
  }
})
