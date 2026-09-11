import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, after, test } from 'node:test'
import { DomainError } from '../dist/common/domain-error.js'
import { transact } from '../dist/database/transaction.js'
import {
  sandbox,
  fixture,
  race,
  orderState,
  issueOrder,
  connect,
  bounded
} from './helpers/database.mjs'

let db
before(async () => {
  db = await sandbox()
})
after(async () => {
  await db?.close()
})
const code = (expected) => (error) => error.code === expected
const checkViolation = (error) =>
  error.meta?.code === '23514' || error.meta?.driverAdapterError?.cause?.originalCode === '23514'
const failed = (result, expected) => {
  assert.equal(result.status, 'rejected')
  assert.equal(result.reason.code, expected)
}

async function assertSingle(f, id, keys) {
  await db.read(async (client) => {
    assert.equal(await client.order.count({ where: { listingId: f.listing.id } }), 1)
    assert.equal(await client.orderSnapshot.count({ where: { orderId: id } }), 1)
    assert.equal(await client.orderShipping.count({ where: { orderId: id } }), 1)
    assert.equal(await client.orderEvent.count({ where: { orderId: id } }), 1)
    assert.equal(await client.idempotencyRecord.count({ where: { key: { in: keys } } }), 1)
    const reservations = await client.inventoryReservation.findMany({
      where: { listingId: f.listing.id }
    })
    assert.equal(reservations.length, 1)
    assert.equal(reservations[0].state, 'active')
    assert.equal(
      (await client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } }))
        .activeOrderId,
      id
    )
  })
}

test('DB-01: two blocked PostgreSQL connections compete for one physical item', async () => {
  const f = await fixture(db),
    a = randomUUID(),
    b = randomUUID()
  const results = await race(
    db,
    (o) => db.market.create(f.buyer, a, f.input, o),
    (o) => db.market.create(f.other, b, f.input, o)
  )
  assert.equal(results[0].status, 'fulfilled')
  failed(results[1], 'UNAVAILABLE')
  await assertSingle(f, results[0].value, [a, b])
})

test('DB-02: concurrent same-key replay and lost-response retry write once; actor scope is isolated', async () => {
  const f = await fixture(db),
    key = randomUUID()
  const results = await race(
    db,
    (o) => db.market.create(f.buyer, key, f.input, o),
    (o) => db.market.create(f.buyer, key, f.input, o)
  )
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'fulfilled')
  const id = results[0].value
  assert.equal(results[1].value, id)
  assert.equal(await db.market.create(f.buyer, key, f.input), id)
  await assert.rejects(db.market.create(f.other, key, f.input), code('UNAVAILABLE'))
  await assertSingle(f, id, [key])
})

test('DB-03: different payload conflicts after commit; rollback lets a waiting request execute', async () => {
  for (const rollback of [false, true]) {
    const f = await fixture(db),
      key = randomUUID()
    const changed = {
      ...f.input,
      shipping: { ...f.input.shipping, recipient: 'Other virtual recipient' }
    }
    const results = await race(
      db,
      (o) =>
        db.market.create(f.buyer, key, f.input, {
          checkpoint: async (...args) => {
            await o.checkpoint(...args)
            if (rollback && args[0] === 'snapshot') throw new DomainError('INJECTED')
          }
        }),
      (o) => db.market.create(f.buyer, key, changed, o)
    )
    if (rollback) {
      failed(results[0], 'INJECTED')
      assert.equal(results[1].status, 'fulfilled')
    } else {
      assert.equal(results[0].status, 'fulfilled')
      failed(results[1], 'IDEMPOTENCY_CONFLICT')
    }
    const id = results[rollback ? 1 : 0].value
    await assertSingle(f, id, [key])
    await db.read(async (client) =>
      assert.equal(
        (await client.orderShipping.findUniqueOrThrow({ where: { orderId: id } })).recipient,
        rollback ? changed.shipping.recipient : f.input.shipping.recipient
      )
    )
  }
})

test('DB-04: cancellation/payment races exercise both lock orders', async () => {
  for (const first of ['cancel', 'pay']) {
    const f = await fixture(db),
      id = await db.market.create(f.buyer, randomUUID(), f.input)
    const second = first === 'cancel' ? 'pay' : 'cancel'
    const results = await race(
      db,
      (o) => db.market.act(f.buyer, randomUUID(), id, first, {}, o),
      (o) => db.market.act(f.buyer, randomUUID(), id, second, {}, o)
    )
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    const state = await orderState(db, id)
    assert.equal(state.order.status, first === 'cancel' ? 'cancelled' : 'pending_delivery')
    assert.equal(state.settlements.length, first === 'pay' ? 1 : 0)
    assert.equal(state.events.length, 2)
    await db.read(async (client) => {
      const inv = await client.physicalInventory.findUniqueOrThrow({
        where: { listingId: f.listing.id }
      })
      assert.equal(inv.availability, first === 'cancel' ? 'available' : 'reserved')
      assert.equal(inv.activeOrderId, first === 'cancel' ? null : id)
      assert.equal(await client.idempotencyRecord.count({ where: { resourceId: id } }), 2)
    })
  }
})

test('DB-05: acceptance/refund races exercise both lock orders with exact settlements', async () => {
  for (const first of ['accept', 'refund']) {
    const f = await fixture(db),
      id = await issueOrder(db, f)
    const call = (action, o) =>
      db.market.act(
        action === 'refund' ? f.seller : f.buyer,
        randomUUID(),
        id,
        action,
        action === 'refund' ? { returnOutcome: 'returned' } : {},
        o
      )
    const results = await race(
      db,
      (o) => call(first, o),
      (o) => call(first === 'accept' ? 'refund' : 'accept', o)
    )
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    const state = await orderState(db, id)
    assert.equal(state.order.status, first === 'accept' ? 'completed' : 'refunded')
    assert.equal(state.settlements.length, first === 'accept' ? 1 : 2)
    assert.equal(state.events.length, 6)
    for (const settlement of state.settlements) {
      assert.equal(settlement.amount.toFixed(18), f.listing.priceAmount.toFixed(18))
      assert.equal(settlement.currency, 'TEST')
    }
    assert.equal(state.reservations[0].state, first === 'accept' ? 'completed' : 'refunded')
    await db.read(async (client) => {
      assert.equal(
        (await client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } }))
          .availability,
        first === 'accept' ? 'sold' : 'refund_hold'
      )
      assert.equal(await client.issueRecord.count({ where: { orderId: id, status: 'open' } }), 0)
      assert.equal(
        (await client.refundRequest.findFirstOrThrow({ where: { orderId: id } })).status,
        first === 'accept' ? 'closed' : 'approved'
      )
    })
  }
})

test('DB-06: replaying old restore cannot release a newly sold reservation', async () => {
  const f = await fixture(db),
    id = await issueOrder(db, f),
    restoreKey = randomUUID()
  await db.market.act(f.seller, randomUUID(), id, 'refund', { returnOutcome: 'returned' })
  const refundedOrder = (await orderState(db, id)).order
  await assert.rejects(db.market.create(f.other, randomUUID(), f.input), code('UNAVAILABLE'))
  await db.market.act(f.seller, restoreKey, id, 'restore', { inHandAndResellable: true })
  const newer = await db.market.create(f.other, randomUUID(), f.input)
  assert.equal(
    await db.market.act(f.seller, restoreKey, id, 'restore', { inHandAndResellable: true }),
    id
  )
  await assert.rejects(
    db.market.act(f.seller, randomUUID(), id, 'restore', { inHandAndResellable: true }),
    code('INVENTORY_CONFLICT')
  )
  await db.read(async (client) => {
    assert.equal(
      (await client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } }))
        .activeOrderId,
      newer
    )
    assert.equal(await client.inventoryReservation.count({ where: { listingId: f.listing.id } }), 2)
    assert.equal(await client.orderEvent.count({ where: { orderId: id, operation: 'restore' } }), 1)
  })
  assert.equal((await orderState(db, id)).settlements.length, 2)
  assert.deepEqual((await orderState(db, id)).order, refundedOrder)
})

test('DB-07: injected inventory/snapshot/event/settlement failures roll back all writes and keys', async () => {
  for (const stage of ['inventory', 'snapshot', 'event']) {
    const f = await fixture(db),
      key = randomUUID()
    await assert.rejects(
      db.market.create(f.buyer, key, f.input, {
        checkpoint: async (at) => {
          if (at === stage) throw new DomainError('INJECTED')
        }
      }),
      code('INJECTED')
    )
    await db.read(async (client) => {
      assert.equal(await client.order.count({ where: { listingId: f.listing.id } }), 0)
      assert.equal(
        await client.inventoryReservation.count({ where: { listingId: f.listing.id } }),
        0
      )
      assert.equal(await client.idempotencyRecord.count({ where: { key } }), 0)
      assert.equal(
        (await client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } }))
          .availability,
        'available'
      )
      assert.equal(await client.orderEvent.count({ where: { actorId: f.buyer } }), 0)
    })
    const id = await db.market.create(f.buyer, key, f.input)
    await assertSingle(f, id, [key])
  }
  for (const action of ['pay', 'refund']) {
    const f = await fixture(db),
      id =
        action === 'pay'
          ? await db.market.create(f.buyer, randomUUID(), f.input)
          : await issueOrder(db, f)
    const before = await orderState(db, id),
      key = randomUUID()
    const actor = action === 'pay' ? f.buyer : f.seller
    await assert.rejects(
      db.market.act(
        actor,
        key,
        id,
        action,
        { returnOutcome: 'returned' },
        {
          checkpoint: async (at) => {
            if (at === 'settlement') throw new DomainError('INJECTED')
          }
        }
      ),
      code('INJECTED')
    )
    assert.deepEqual(await orderState(db, id), before)
    await db.read(async (client) =>
      assert.equal(await client.idempotencyRecord.count({ where: { key } }), 0)
    )
    await db.market.act(actor, key, id, action, { returnOutcome: 'returned' })
    assert.equal((await orderState(db, id)).settlements.length, before.settlements.length + 1)
  }
})

test('DB-08: withdrawal survives cancellation; edits and purchases serialize whole snapshots', async () => {
  const f = await fixture(db),
    id = await db.market.create(f.buyer, randomUUID(), f.input)
  await db.market.edit(f.seller, f.listing.id, 1, { publicationStatus: 'withdrawn' })
  await db.market.act(f.buyer, randomUUID(), id, 'cancel')
  await db.read(async (client) =>
    assert.equal(
      (await client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).publicationStatus,
      'withdrawn'
    )
  )
  for (const editFirst of [true, false]) {
    const g = await fixture(db)
    const edit = (o) =>
      db.market.edit(g.seller, g.listing.id, 1, { priceAmount: '2.5', title: 'Version two' }, o)
    const buy = (o) => db.market.create(g.buyer, randomUUID(), g.input, o)
    const result = await race(db, editFirst ? edit : buy, editFirst ? buy : edit)
    assert.equal(result[0].status, 'fulfilled')
    if (editFirst) {
      failed(result[1], 'LISTING_CONFLICT')
      await db.read(async (client) =>
        assert.equal(await client.order.count({ where: { listingId: g.listing.id } }), 0)
      )
    } else {
      assert.equal(result[1].status, 'fulfilled')
      const snapshot = (await orderState(db, result[0].value)).snapshots[0]
      assert.equal(snapshot.title, 'Version one')
      assert.equal(snapshot.listingVersion, 1)
      assert.equal(snapshot.priceAmount.toFixed(18), g.listing.priceAmount.toFixed(18))
    }
  }
})

test('DB-09: exact decimals and direct invalid database writes are constrained', async () => {
  const f = await fixture(db),
    id = await db.market.create(f.buyer, randomUUID(), f.input)
  const state = await orderState(db, id)
  assert.equal(
    state.snapshots[0].priceAmount.toFixed(18),
    '12345678901234567890.123456789012345678'
  )
  const extra = await db.client.order.create({
    data: { listingId: f.listing.id, sellerId: f.seller, buyerId: f.other }
  })
  await assert.rejects(
    db.client.inventoryReservation.create({ data: { listingId: f.listing.id, orderId: extra.id } }),
    code('P2002')
  )
  const g = await fixture(db),
    otherId = await db.market.create(g.buyer, randomUUID(), g.input)
  await assert.rejects(
    db.client.physicalInventory.update({
      where: { listingId: f.listing.id },
      data: { activeOrderId: otherId }
    }),
    code('P2003')
  )
  const unrelated = await db.client.order.create({
    data: { listingId: g.listing.id, sellerId: g.seller, buyerId: g.other }
  })
  await assert.rejects(
    db.client.inventoryReservation.create({
      data: {
        listingId: f.listing.id,
        orderId: unrelated.id,
        state: 'cancelled',
        closedAt: new Date()
      }
    }),
    code('P2003')
  )
  await db.market.act(f.buyer, randomUUID(), id, 'pay')
  await assert.rejects(
    db.client.settlementRecord.create({
      data: { orderId: id, operation: 'payment', amount: f.listing.priceAmount, currency: 'TEST' }
    }),
    code('P2002')
  )
  await assert.rejects(
    db.client.settlementRecord.create({
      data: { orderId: id, operation: 'refund', amount: '1', currency: 'TEST' }
    }),
    code('P2003')
  )
  await assert.rejects(
    db.client
      .$executeRaw`UPDATE "OrderSnapshot" SET "title" = 'tampered' WHERE "orderId" = ${id}::uuid`,
    checkViolation
  )
  await assert.rejects(
    db.client
      .$executeRaw`UPDATE "PhysicalInventory" SET "availability" = 'available' WHERE "listingId" = ${f.listing.id}::uuid`,
    checkViolation
  )
  const incomplete = randomUUID()
  await assert.rejects(
    db.client
      .$executeRaw`INSERT INTO "IdempotencyRecord" ("actorId", "operation", "key", "requestHash") VALUES (${f.buyer}::uuid, 'test', ${incomplete}, ${'a'.repeat(64)})`,
    checkViolation
  )
  await db.read(async (client) => {
    assert.equal(await client.idempotencyRecord.count({ where: { key: incomplete } }), 0)
    assert.equal(
      (await client.orderSnapshot.findUniqueOrThrow({ where: { orderId: id } })).title,
      'Version one'
    )
    assert.equal(await client.settlementRecord.count({ where: { orderId: id } }), 1)
    assert.equal(await client.inventoryReservation.count({ where: { listingId: f.listing.id } }), 1)
  })
})

test('DB-11: real lock timeout retries whole transactions and exhausts without fragments', async () => {
  const f = await fixture(db),
    blocker = await connect(db.url)
  let release
  const held = new Promise((resolve) => {
    release = resolve
  })
  let locked
  const acquired = new Promise((resolve) => {
    locked = resolve
  })
  const holding = blocker.client.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${f.listing.id}::uuid FOR UPDATE`
      locked()
      await bounded(held, 'Lock-timeout test barrier was not released')
    },
    { timeout: 10000 }
  )
  holding.catch(() => {})
  const key = randomUUID(),
    attempts = []
  try {
    await bounded(acquired, 'Lock-timeout test failed to acquire its lock')
    await assert.rejects(
      db.market.create(f.buyer, key, f.input, {
        lockTimeoutMs: 50,
        maxAttempts: 3,
        checkpoint: async (stage, tx, attempt) => {
          if (stage === 'begin') attempts.push(attempt)
        }
      }),
      code('RETRY_EXHAUSTED')
    )
    assert.deepEqual(attempts, [1, 2, 3])
  } finally {
    release()
    await holding
    await blocker.onModuleDestroy()
  }
  await db.read(async (client) => {
    assert.equal(await client.order.count({ where: { listingId: f.listing.id } }), 0)
    assert.equal(await client.idempotencyRecord.count({ where: { key } }), 0)
  })
  await db.market.create(f.buyer, key, f.input)
  await db.read(async (client) =>
    assert.equal(await client.order.count({ where: { listingId: f.listing.id } }), 1)
  )
})

test('DB-11: retryable SQLSTATE reruns the whole callback; domain and unique errors do not retry', async () => {
  const marker = randomUUID(),
    attempts = []
  await transact(db.client, async (tx, attempt) => {
    attempts.push(attempt)
    await tx.account.create({ data: { loginName: marker, displayName: 'Retry fixture' } })
    if (attempt === 1)
      await tx.$executeRawUnsafe(
        "DO $$ BEGIN RAISE EXCEPTION 'injected serialization failure' USING ERRCODE = '40001'; END $$"
      )
  })
  assert.deepEqual(attempts, [1, 2])
  await db.read(async (client) =>
    assert.equal(await client.account.count({ where: { loginName: marker } }), 1)
  )
  for (const mode of ['unique', 'forbidden', 'state']) {
    let calls = 0
    await assert.rejects(
      transact(db.client, async (tx) => {
        calls++
        if (mode === 'unique')
          return tx.account.create({ data: { loginName: marker, displayName: 'Duplicate' } })
        throw new DomainError(mode === 'forbidden' ? 'FORBIDDEN' : 'STATE_CONFLICT')
      })
    )
    assert.equal(calls, 1)
  }
})

test('digital items sell repeatedly with independent immutable snapshots and no inventory', async () => {
  const f = await fixture(db, 'digital')
  const first = await db.market.create(f.buyer, randomUUID(), f.input)
  const second = await db.market.create(f.other, randomUUID(), f.input)
  assert.notEqual(first, second)
  await db.market.act(f.buyer, randomUUID(), first, 'pay')
  await db.market.act(f.seller, randomUUID(), first, 'deliver', {
    reference: 'https://example.invalid/fixture'
  })
  await db.market.act(f.buyer, randomUUID(), first, 'accept')
  await db.read(async (client) => {
    assert.equal(await client.physicalInventory.count({ where: { listingId: f.listing.id } }), 0)
    assert.equal(await client.order.count({ where: { listingId: f.listing.id } }), 2)
    assert.equal(
      (await client.order.findUniqueOrThrow({ where: { id: first } })).status,
      'completed'
    )
    assert.equal(
      (await client.order.findUniqueOrThrow({ where: { id: second } })).status,
      'pending_payment'
    )
  })
})

test('DB-11: repeated retryable errors roll back writes on every exhausted attempt', async () => {
  const marker = randomUUID(),
    attempts = []
  await assert.rejects(
    transact(
      db.client,
      async (tx, attempt) => {
        attempts.push(attempt)
        await tx.account.create({ data: { loginName: marker, displayName: 'Must roll back' } })
        await tx.$executeRawUnsafe(
          "DO $$ BEGIN RAISE EXCEPTION 'injected deadlock SQLSTATE' USING ERRCODE = '40P01'; END $$"
        )
      },
      { maxAttempts: 2 }
    ),
    code('RETRY_EXHAUSTED')
  )
  assert.deepEqual(attempts, [1, 2])
  await db.read(async (client) =>
    assert.equal(await client.account.count({ where: { loginName: marker } }), 0)
  )
})

test('experimental use cases reject foreign actors and require delivery plus bilateral refunds', async () => {
  const f = await fixture(db),
    id = await db.market.create(f.buyer, randomUUID(), f.input)
  const before = await orderState(db, id)
  await assert.rejects(db.market.act(f.other, randomUUID(), id, 'pay'), code('FORBIDDEN'))
  await assert.rejects(
    db.market.edit(f.other, f.listing.id, 1, { title: 'forged' }),
    code('FORBIDDEN')
  )
  assert.deepEqual(await orderState(db, id), before)
  await db.market.act(f.buyer, randomUUID(), id, 'pay')
  await db.market.act(f.buyer, randomUUID(), id, 'issue', { description: 'Virtual non-delivery' })
  await assert.rejects(
    db.market.act(f.buyer, randomUUID(), id, 'accept'),
    code('DELIVERY_REQUIRED')
  )
  await assert.rejects(
    db.market.act(f.seller, randomUUID(), id, 'refund', { returnOutcome: 'not_sent' }),
    code('REFUND_REQUIRED')
  )
  await db.market.act(f.buyer, randomUUID(), id, 'request_refund')
  await assert.rejects(db.market.act(f.seller, randomUUID(), id, 'refund'), code('RETURN_REQUIRED'))
  await db.market.act(f.seller, randomUUID(), id, 'refund', { returnOutcome: 'not_sent' })
  await assert.rejects(
    db.market.act(f.seller, randomUUID(), id, 'restore'),
    code('RESTORE_CONFLICT')
  )
  const state = await orderState(db, id)
  assert.equal(state.order.status, 'refunded')
  assert.equal(state.settlements.length, 2)
  await db.read(async (client) => {
    assert.equal(await client.orderEvent.count({ where: { actorId: f.other } }), 0)
    assert.equal(await client.idempotencyRecord.count({ where: { actorId: f.other } }), 0)
    assert.equal(
      (await client.physicalInventory.findUniqueOrThrow({ where: { listingId: f.listing.id } }))
        .availability,
      'refund_hold'
    )
  })
})

test('DB-09: approved refund CHECK rejects a missing return outcome, including SQL NULL', async () => {
  const f = await fixture(db),
    id = await issueOrder(db, f)
  await assert.rejects(
    db.client
      .$executeRaw`UPDATE "RefundRequest" SET "status" = 'approved', "approvedBy" = ${f.seller}::uuid, "approvedAt" = now() WHERE "orderId" = ${id}::uuid`,
    checkViolation
  )
  await db.read(async (client) => {
    assert.equal(
      (await client.refundRequest.findFirstOrThrow({ where: { orderId: id } })).status,
      'pending'
    )
    assert.equal(
      await client.settlementRecord.count({ where: { orderId: id, operation: 'refund' } }),
      0
    )
  })
})
