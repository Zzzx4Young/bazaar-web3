import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, after, test } from 'node:test'
import { sandbox, fixture } from './helpers/database.mjs'
import { ListingReviewController } from '../dist/listings/listing-review.controller.js'
import { ListingService } from '../dist/listings/listing.service.js'
import { OrderCommands } from '../dist/orders/order-commands.js'
import { OrderController } from '../dist/orders/order.controller.js'
import { fixtureMediaAsset } from './helpers/media.mjs'
import { exampleCommitment } from '../scripts/example-commitment.mjs'

let db
before(async () => { db = await sandbox() })
after(async () => { await db?.close() })

const actor = (id, role = 'participant') => ({ auth: { account: { id, role } } })

test('legacy listing is browsable data but cannot create a new order', async () => {
  const f = await fixture(db)
  await db.client.listing.update({ where: { id: f.listing.id }, data: {
    commitment: null, commitmentVersion: null
  } })
  await assert.rejects(db.market.create(f.buyer, randomUUID(), f.input),
    (error) => error.code === 'LISTING_CONFLICT')
  assert.equal((await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).title,
    'Version one')
})

test('purchase freezes commitment; later repeatable edits only affect new orders', async () => {
  const f = await fixture(db, 'digital')
  await db.client.listing.update({ where: { id: f.listing.id }, data: { saleMode: 'repeatable' } })
  const first = await db.market.create(f.buyer, randomUUID(), f.input)
  const firstSnapshot = await db.client.orderSnapshot.findUniqueOrThrow({ where: { orderId: first } })
  const revised = { ...f.listing.commitment, sellerUseNotes: 'Two test projects' }
  await db.market.edit(f.seller, f.listing.id, 1, { commitment: revised })
  const second = await db.market.create(f.other, randomUUID(), { ...f.input, version: 2 })
  const secondSnapshot = await db.client.orderSnapshot.findUniqueOrThrow({ where: { orderId: second } })
  assert.equal(firstSnapshot.commitment.sellerUseNotes, 'One test project')
  assert.equal(secondSnapshot.commitment.sellerUseNotes, 'Two test projects')
})

test('online access snapshot uses the server acceptance event without computing an expiry', async () => {
  const f = await fixture(db, 'digital')
  const media = await fixtureMediaAsset(db, f.seller)
  await db.client.listingMedia.create({ data: {
    listingId: f.listing.id, mediaId: media.id, position: 0
  } })
  const access = { ...exampleCommitment('digital'), resourceMode: 'access',
    accessDurationValue: 30, accessDurationUnit: 'days',
    accessTermNotes: 'Seller counts from buyer acceptance',
    expiryBehavior: 'Reading ends; renewal requires a new order' }
  await db.market.edit(f.seller, f.listing.id, 1, { commitment: access })
  const orderId = await db.market.create(f.buyer, randomUUID(), { ...f.input, version: 2 })
  const snapshot = await db.client.orderSnapshot.findUniqueOrThrow({ where: { orderId } })
  assert.equal(snapshot.commitmentVersion, 1)
  assert.equal(snapshot.commitment.resourceMode, 'access')
  assert.equal(snapshot.commitment.accessDurationValue, 30)
  assert.equal(await db.client.orderMediaSnapshot.count({ where: { orderId } }), 1)
  await db.market.act(f.buyer, randomUUID(), orderId, 'pay')
  await db.market.act(f.seller, randomUUID(), orderId, 'deliver', {
    reference: 'https://example.com/private-access'
  })
  await db.market.act(f.buyer, randomUUID(), orderId, 'accept')
  const event = await db.client.orderEvent.findFirstOrThrow({ where: {
    orderId, operation: 'accept'
  } })
  const detail = await new OrderController(db.database).detail(actor(f.buyer), orderId)
  assert.equal(detail.acceptedAt.getTime(), event.createdAt.getTime())
  assert.equal(detail.snapshot.commitment.accessDurationValue, 30)
  assert.equal('expiryAt' in detail, false)
  assert.equal('activatedAt' in detail, false)
})

test('source report pauses transactions until seller evidence and admin review', async () => {
  const f = await fixture(db, 'digital')
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  const review = new ListingReviewController(db.database)
  await review.report(actor(f.other), f.listing.id, { kind: 'source', reason: 'Source unclear' })
  assert.equal((await db.client.order.findUniqueOrThrow({ where: { id: orderId } })).transactionPausedAt, null)
  assert.equal((await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).reviewPending,
    true)
  await review.pause(actor(f.other, 'admin'), f.listing.id,
    { kind: 'source', reason: 'Source complaint needs review' })
  const paused = await db.client.order.findUniqueOrThrow({ where: { id: orderId } })
  assert.ok(paused.transactionPausedAt)
  await assert.rejects(db.market.act(f.buyer, randomUUID(), orderId, 'pay'),
    (error) => error.code === 'STATE_CONFLICT')
  await assert.rejects(review.review(actor(f.other, 'admin'), f.listing.id,
    { outcome: 'resume', reason: 'Insufficient response' }),
    (error) => error.code === 'STATE_CONFLICT')
  await review.sourceResponse(actor(f.seller), f.listing.id, {
    explanation: 'Original work', creationProcess: 'Created from my own project files'
  })
  await review.review(actor(f.other, 'admin'), f.listing.id,
    { outcome: 'resume', reason: 'Listing may continue under platform rules' })
  const resumed = await db.client.order.findUniqueOrThrow({ where: { id: orderId } })
  assert.equal(resumed.transactionPausedAt, null)
  assert.equal(resumed.status, 'pending_payment')
})

test('paused pending payment still expires and is not resumed by later review', async () => {
  const f = await fixture(db)
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  const review = new ListingReviewController(db.database)
  await review.report(actor(f.other), f.listing.id,
    { kind: 'listing_rule', reason: 'Listing wording needs review' })
  await review.pause(actor(f.other, 'admin'), f.listing.id,
    { kind: 'listing_rule', reason: 'Listing wording needs review' })
  await db.market.expirePendingPaymentOrders(new Date(Date.now() + 31 * 60 * 1000))
  await review.review(actor(f.other, 'admin'), f.listing.id,
    { outcome: 'resume', reason: 'May continue' })
  const order = await db.client.order.findUniqueOrThrow({ where: { id: orderId } })
  assert.equal(order.status, 'expired')
  assert.equal(order.transactionPausedAt, null)
})

test('rule violation requires manual cancellation or simulated refund', async () => {
  const f = await fixture(db)
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  const review = new ListingReviewController(db.database)
  await review.report(actor(f.other), f.listing.id,
    { kind: 'listing_rule', reason: 'Excluded claim' })
  await review.pause(actor(f.other, 'admin'), f.listing.id,
    { kind: 'listing_rule', reason: 'Excluded claim' })
  await review.review(actor(f.other, 'admin'), f.listing.id,
    { outcome: 'rule_violation', reason: 'Fails listing rule' })
  await assert.rejects(db.market.act(f.buyer, randomUUID(), orderId, 'pay'),
    (error) => error.code === 'STATE_CONFLICT')
  const result = await review.resolveAffectedOrder(actor(f.other, 'admin'), f.listing.id,
    orderId, { reason: 'Manual cancellation after review' })
  assert.equal(result.status, 'cancelled')
  const inventory = await db.client.physicalInventory.findUniqueOrThrow({
    where: { listingId: f.listing.id }
  })
  assert.equal(inventory.availability, 'available')
  assert.equal((await db.client.orderSnapshot.findUniqueOrThrow({ where: { orderId } })).title,
    'Version one')
})

test('cart checkout rolls back when one listing lacks a commitment', async () => {
  const a = await fixture(db)
  const b = await fixture(db)
  await db.client.listing.update({ where: { id: b.listing.id }, data: {
    commitment: null, commitmentVersion: null
  } })
  const commands = new OrderCommands(db.client)
  await assert.rejects(commands.createCheckout(a.buyer, randomUUID(), [
    a.input, { ...b.input, shipping: a.input.shipping }
  ]), (error) => error.code === 'LISTING_CONFLICT')
  assert.equal(await db.client.order.count({ where: { listingId: a.listing.id } }), 0)
  assert.equal((await db.client.physicalInventory.findUniqueOrThrow({
    where: { listingId: a.listing.id }
  })).availability, 'available')
})

test('paid affected order receives one manual simulated refund and audit event', async () => {
  const f = await fixture(db)
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  await db.market.act(f.buyer, randomUUID(), orderId, 'pay')
  const review = new ListingReviewController(db.database)
  await review.report(actor(f.other), f.listing.id,
    { kind: 'listing_rule', reason: 'Cannot list this item' })
  await review.pause(actor(f.other, 'admin'), f.listing.id,
    { kind: 'listing_rule', reason: 'Cannot list this item' })
  await review.review(actor(f.other, 'admin'), f.listing.id,
    { outcome: 'rule_violation', reason: 'Listing rule issue' })
  const result = await review.resolveAffectedOrder(actor(f.other, 'admin'), f.listing.id,
    orderId, { reason: 'Manual simulated refund', returnOutcome: 'not_sent' })
  assert.equal(result.status, 'refunded')
  assert.equal(await db.client.settlementRecord.count({ where: {
    orderId, operation: 'refund'
  } }), 1)
  assert.equal((await db.client.physicalInventory.findUniqueOrThrow({
    where: { listingId: f.listing.id }
  })).availability, 'refund_hold')
  await assert.rejects(review.resolveAffectedOrder(actor(f.other, 'admin'), f.listing.id,
    orderId, { reason: 'Duplicate refund', returnOutcome: 'not_sent' }),
    (error) => error.code === 'STATE_CONFLICT')
})

test('reported listing stays buyable until administrator pauses it', async () => {
  const f = await fixture(db)
  const review = new ListingReviewController(db.database)
  await review.report(actor(f.other), f.listing.id,
    { kind: 'listing_rule', reason: 'Please check listing' })
  const listing = await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })
  assert.equal(listing.reviewStatus, 'clear')
  assert.equal(listing.reviewPending, true)
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  assert.ok(orderId)
  await assert.rejects(review.report(actor(f.other), f.listing.id,
    { kind: 'listing_rule', reason: 'Repeat report' }),
    (error) => error.code === 'STATE_CONFLICT')
  await review.dismiss(actor(f.other, 'admin'), f.listing.id,
    { reason: 'No listing rule problem found' })
  assert.equal((await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).reviewPending,
    false)
})

test('one-off replacement cannot reuse occupied stock and waits for review after release', async () => {
  const f = await fixture(db)
  const orderId = await db.market.create(f.buyer, randomUUID(), f.input)
  const service = new ListingService(db.client, {})
  const asset = await fixtureMediaAsset(db, f.seller)
  const input = { type: 'physical', saleMode: 'one_off', title: 'Replacement candidate',
    description: 'Example item for distinct stock review', category: 'electronics',
    price: { amount: '10', currency: 'USD' }, mediaIds: [asset.id],
    commitment: exampleCommitment('physical'), replacementOfListingId: f.listing.id }
  await assert.rejects(service.create(f.seller, input), (error) => error.code === 'UNAVAILABLE')
  await db.market.act(f.buyer, randomUUID(), orderId, 'cancel')
  await assert.rejects(service.create(f.seller, input), (error) => error.code === 'UNAVAILABLE')
  await db.client.listing.update({ where: { id: f.listing.id }, data: {
    commitment: null, commitmentVersion: null
  } })
  const newListing = await service.create(f.seller, input)
  assert.equal(newListing.reviewStatus, 'paused')
  assert.equal(newListing.replacementOfListingId, f.listing.id)
  const review = new ListingReviewController(db.database)
  await review.review(actor(f.other, 'admin'), newListing.id,
    { outcome: 'resume', reason: 'Distinct item and stock checked' })
  assert.equal((await db.client.listing.findUniqueOrThrow({ where: { id: newListing.id } })).reviewStatus,
    'clear')
  await assert.rejects(db.market.create(f.other, randomUUID(), {
    listingId: f.listing.id, version: f.listing.version, shipping: f.input.shipping
  }), (error) => error.code === 'LISTING_CONFLICT')
})
