import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sandbox, fixture, deferred } from './helpers/database.mjs'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { AuthService } from '../dist/auth/auth.service.js'
import { WalletAuthService } from '../dist/auth/wallet-auth.service.js'
import { SellerPayoutService } from '../dist/web3/seller-payout.service.js'
import { ListingService } from '../dist/listings/listing.service.js'
import { RatesService } from '../dist/pricing/rates.service.js'
import { ListingCommands } from '../dist/listings/listing-commands.js'
import { OrderCommands } from '../dist/orders/order-commands.js'
import { hashPassword } from '../dist/auth/password.js'
import { readConfig } from '../dist/config.js'

const password = 'Virtual-T03-seller-password-only'
async function setup() {
  const db = await sandbox(), security = await isolatedLedger(), f = await fixture(db, 'digital', '10')
  await db.client.digitalInventory.create({ data: { listingId: f.listing.id } })
  await db.client.accountCredential.create({ data: { accountId: f.seller, passwordHash: await hashPassword(password) } })
  const config = { chainId: 11155111, tokenDecimals: 6, token: '0x' + '1'.repeat(40), escrow: '0x' + '2'.repeat(40),
    rpcPrimary: 'https://one.invalid', rpcSecondary: 'https://two.invalid', securityLedgerUrl: db.url.toString(), securityLedgerId: security.id }
  const auth = new AuthService(db.client, readConfig({ DATABASE_URL: db.url.toString() }), security.ledger)
  const account = await db.client.account.findUniqueOrThrow({ where: { id: f.seller } })
  const user = await auth.login(account.loginName, password, '127.0.0.1')
  let offset = 0
  const wallets = new WalletAuthService(db.client, auth, security.ledger, { ...config,
    appOrigin: 'http://localhost:3000', assertEoa: async () => {}, now: () => new Date(Date.now() + offset) })
  const payout = new SellerPayoutService(db.client, wallets, security.ledger, config)
  const listings = new ListingCommands(db.client, config), orders = new OrderCommands(db.client, payout)
  const w = privateKeyToAccount(generatePrivateKey())
  const challenge = async (purpose, wallet = w) => {
    const key = randomUUID(), proof = await wallets.requestPasswordReauth(user, password, purpose, wallet.address, key, '127.0.0.1')
    return wallets.createActionChallenge(user, proof.id, purpose, wallet.address, key)
  }
  const bind = async (wallet = w) => { const c = await challenge('bind', wallet); return wallets.consumeActionChallenge(user, c.id, await wallet.signTypedData(c.typedData)) }
  const confirm = async () => { const c = await challenge('payout'); return payout.confirmSellerPayout(user, c.id, await w.signTypedData(c.typedData)) }
  const price = async amount => {
    const l = await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })
    return listings.edit(f.seller, l.id, l.version, { testnetPriceAmount: amount })
  }
  const create = async (options = {}, version) => orders.create(f.buyer, randomUUID(), {
    listingId: f.listing.id, version: version ?? (await db.client.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).version,
    settlementMode: 'testnet_escrow' }, options)
  return { db, security, f, config, auth, user, wallets, payout, listings, orders, w, challenge, bind, confirm, price, create,
    tick: ms => { offset += ms },
    close: async () => { await db.close(); await security.close() } }
}

test('A29/A32: payout signatures are dedicated, version-bound, one-use; prices never round', async () => {
  const t = await setup()
  try {
    await t.bind()
    const c = await t.challenge('payout')
    assert.equal(c.typedData.domain.name, 'Bazaar Seller Payout')
    await assert.rejects(t.wallets.consumeActionChallenge(t.user, c.id, await t.w.signTypedData(c.typedData)), /INVALID_CREDENTIALS/)
    const confirmed = await t.payout.confirmSellerPayout(t.user, c.id.toUpperCase(), await t.w.signTypedData(c.typedData))
    assert.deepEqual(await t.payout.confirmSellerPayout(t.user, c.id, await t.w.signTypedData(c.typedData)), confirmed)
    assert.equal(await t.db.client.sellerPayoutConfirmation.count({ where: { revokedAt: null } }), 1)
    for (const amount of ['0', '-1', '1.0000001', '1e6']) await assert.rejects(t.price(amount), /INVALID_AMOUNT/)
    await t.price('12.000001')
    const id = await t.create(), snapshot = await t.payout.existingOrderTerms(t.f.buyer, id)
    assert.equal(snapshot.amountAtoms, '12000001')
    assert.equal(snapshot.sellerWallet, t.w.address.toLowerCase())
    assert.equal(snapshot.token, t.config.token)
    assert.equal(snapshot.listingVersion, 2)
    assert.equal((await t.db.client.orderSnapshot.findUniqueOrThrow({ where: { orderId: id } })).priceAmount.toString(), '10')
    await assert.rejects(t.orders.act(t.f.buyer, randomUUID(), id, 'pay'), /STATE_CONFLICT/)
    await assert.rejects(t.orders.act(t.f.other, randomUUID(), id, 'pay'), /FORBIDDEN/)
  } finally { await t.close() }
})

test('A31: changing wallet revokes payout atomically; old orders retain fixed terms and old confirmation cannot return', async () => {
  const t = await setup()
  try {
    await t.bind(); await t.confirm(); await t.price('1.25')
    const id = await t.create(), original = await t.payout.existingOrderTerms(t.f.buyer, id)
    const old = await t.db.client.sellerPayoutConfirmation.findFirstOrThrow()
    const next = privateKeyToAccount(generatePrivateKey())
    await t.bind(next)
    assert.ok((await t.db.client.sellerPayoutConfirmation.findUniqueOrThrow({ where: { id: old.id } })).revokedAt)
    await t.price('8.5')
    await assert.rejects(t.create(), /STATE_CONFLICT/)
    assert.deepEqual(await t.payout.existingOrderTerms(t.f.buyer, id), original)
    await t.bind(t.w)
    await t.payout.confirmSellerPayout(t.user, old.challengeId, old.signature)
    await t.db.client.sellerPayoutConfirmation.update({ where: { id: old.id }, data: { revokedAt: null } })
    await assert.rejects(t.create(), /STATE_CONFLICT/)
    assert.deepEqual(await t.payout.existingOrderTerms(t.f.buyer, id), original)
  } finally { await t.close() }
})

test('A29: order wins the listing lock, snapshots old price, and repricing creates only a new version', async () => {
  const t = await setup(), locked = deferred(), release = deferred()
  try {
    await t.bind(); await t.confirm(); const l = await t.price('1')
    const buying = t.create({ checkpoint: async stage => { if (stage === 'locked') { locked.resolve(); await release.promise } } }, l.version)
    await locked.promise
    const editing = t.listings.edit(t.f.seller, l.id, l.version, { testnetPriceAmount: '9.999999' })
    release.resolve()
    const id = await buying; await editing
    assert.equal((await t.payout.existingOrderTerms(t.f.buyer, id)).amountAtoms, '1000000')
    assert.equal((await t.db.client.listingTestnetPrice.findFirstOrThrow({ orderBy: { listingVersion: 'desc' } })).amountAtoms, '9999999')
  } finally { release.resolve(); await t.close() }
})

test('A29: price update wins, stale version order is rejected without inventory or snapshot writes', async () => {
  const t = await setup(), locked = deferred(), release = deferred()
  try {
    await t.bind(); await t.confirm(); const l = await t.price('1')
    const editing = t.listings.edit(t.f.seller, l.id, l.version, { testnetPriceAmount: '2' }, {
      checkpoint: async stage => { if (stage === 'locked') { locked.resolve(); await release.promise } } })
    await locked.promise
    const buying = t.create({}, l.version)
    release.resolve(); await editing
    await assert.rejects(buying, /LISTING_CONFLICT/)
    assert.equal(await t.db.client.order.count(), 0)
    assert.equal((await t.db.client.digitalInventory.findUniqueOrThrow({ where: { listingId: l.id } })).availability, 'available')
  } finally { release.resolve(); await t.close() }
})

test('A31: order eligibility wins before wallet change; snapshot remains old and subsequent new orders fail', async () => {
  const t = await setup(), ready = deferred(), release = deferred()
  try {
    await t.bind(); await t.confirm(); await t.price('3')
    const next = privateKeyToAccount(generatePrivateKey()), c = await t.challenge('bind', next)
    const buying = t.create({ checkpoint: async stage => { if (stage === 'eligibility') { ready.resolve(); await release.promise } } })
    await ready.promise
    const prepared = deferred(), prepare = t.security.ledger.prepare.bind(t.security.ledger)
    t.security.ledger.prepare = async change => { const result = await prepare(change); prepared.resolve(); return result }
    const changing = t.wallets.consumeActionChallenge(t.user, c.id, await next.signTypedData(c.typedData))
    await prepared.promise
    release.resolve()
    const id = await buying; await changing
    assert.equal((await t.payout.existingOrderTerms(t.f.buyer, id)).sellerWallet, t.w.address.toLowerCase())
    await assert.rejects(t.create(), /STATE_CONFLICT/)
  } finally { release.resolve(); await t.close() }
})

test('A32: payout challenge expires at the original deadline; saved confirmation remains valid afterwards', async () => {
  const t = await setup()
  try {
    await t.bind()
    const c = await t.challenge('payout'), signature = await t.w.signTypedData(c.typedData)
    t.tick(300_000)
    await assert.rejects(t.payout.confirmSellerPayout(t.user, c.id, signature), /INVALID_CREDENTIALS/)
    await t.confirm(); await t.price('0.000001')
    t.tick(301_000)
    const id = await t.create()
    assert.equal((await t.payout.existingOrderTerms(t.f.buyer, id)).amountAtoms, '1')
  } finally { await t.close() }
})

test('A31: wallet changes do not block existing Alpha fulfillment', async () => {
  const t = await setup()
  try {
    await t.bind(); await t.confirm(); const listing = await t.price('4')
    const alphaId = await t.orders.create(t.f.buyer, randomUUID(), { listingId: listing.id, version: listing.version })
    await t.bind(privateKeyToAccount(generatePrivateKey()))
    await t.orders.act(t.f.buyer, randomUUID(), alphaId, 'pay')
    await t.orders.act(t.f.seller, randomUUID(), alphaId, 'deliver', { reference: 'Virtual alpha delivery' })
    await t.orders.act(t.f.buyer, randomUUID(), alphaId, 'accept')
    assert.equal((await t.db.client.order.findUniqueOrThrow({ where: { id: alphaId } })).status, 'completed')
  } finally { await t.close() }
})

test('A32: late concurrent payout retries replay the original result even though only revision advances', async () => {
  const t = await setup(), entered = deferred(), release = deferred()
  try {
    await t.bind()
    const c = await t.challenge('payout'), signature = await t.w.signTypedData(c.typedData)
    const lateWallets = new WalletAuthService(t.db.client, t.auth, t.security.ledger, { ...t.config,
      appOrigin: 'http://localhost:3000', assertEoa: async () => { entered.resolve(); await release.promise } })
    const latePayout = new SellerPayoutService(t.db.client, lateWallets, t.security.ledger, t.config)
    const late = latePayout.confirmSellerPayout(t.user, c.id, signature)
    await entered.promise
    let first
    try { first = await t.payout.confirmSellerPayout(t.user, c.id, signature) }
    finally { release.resolve() }
    assert.deepEqual(await late, first)
    assert.equal(await t.db.client.sellerPayoutConfirmation.count(), 1)
  } finally { release.resolve(); await t.close() }
})

test('A29: switching a priced file to access drops the new-version test price; explicit access pricing is rejected', async () => {
  const t = await setup()
  try {
    const l = await t.price('1')
    const access = { ...t.f.listing.commitment, resourceMode: 'access', accessDurationValue: 1,
      accessDurationUnit: 'months', accessTermNotes: 'One month', expiryBehavior: 'Access ends' }
    await assert.rejects(t.listings.edit(t.f.seller, l.id, l.version, { commitment: access, testnetPriceAmount: '2' }), /INVALID_INPUT/)
    const next = await t.listings.edit(t.f.seller, l.id, l.version, { commitment: access })
    assert.equal(await t.db.client.listingTestnetPrice.count({ where: { listingId: l.id, listingVersion: next.version } }), 0)
  } finally { await t.close() }
})

test('A31: public eligibility pauses on rebind and switchback until exact-version reconfirmation', async () => {
  const t = await setup()
  const service = new ListingService(t.db.client, new RatesService(t.db.client), 'compat', t.config)
  const check = async (eligible, reason) => {
    const detail = await service.detail(t.f.listing.id)
    const page = await service.list({})
    for (const view of [detail, page.items[0]]) {
      assert.equal(view.testnetPurchaseEligible, eligible)
      assert.equal(view.testnetPurchaseBlockReason, reason)
      assert.deepEqual(view.seller, { id: t.f.seller, displayName: 'Fixture 0' })
      assert.ok(!JSON.stringify(view).includes('bindingVersion'))
    }
  }
  try {
    await t.db.client.listing.update({ where: { id: t.f.listing.id }, data: { currency: 'USD' } })
    await t.price('1.25')
    await check(false, 'payout_unconfirmed')
    await t.bind(); await check(false, 'payout_unconfirmed')
    await t.confirm(); await check(true, null)
    const id = await t.create(), original = await t.payout.existingOrderTerms(t.f.buyer, id)
    const old = await t.db.client.sellerPayoutConfirmation.findFirstOrThrow()
    await t.bind(privateKeyToAccount(generatePrivateKey()))
    await t.price('8.5'); await check(false, 'payout_unconfirmed')
    await assert.rejects(t.create(), /STATE_CONFLICT/)
    await t.bind(t.w)
    await t.db.client.sellerPayoutConfirmation.update({ where: { id: old.id }, data: { revokedAt: null } })
    await check(false, 'payout_unconfirmed')
    await assert.rejects(t.create(), /STATE_CONFLICT/)
    await t.confirm(); await check(true, null)
    assert.deepEqual(await t.payout.existingOrderTerms(t.f.buyer, id), original)
  } finally { await t.close() }
})

test('A31: public eligibility pauses after unbind and existing seller address stays fixed', async () => {
  const t = await setup()
  const service = new ListingService(t.db.client, new RatesService(t.db.client), 'compat', t.config)
  try {
    await t.db.client.listing.update({ where: { id: t.f.listing.id }, data: { currency: 'USD' } })
    await t.bind(); await t.confirm(); await t.price('1')
    const id = await t.create(), original = await t.payout.existingOrderTerms(t.f.buyer, id)
    const c = await t.challenge('unbind')
    await t.wallets.consumeActionChallenge(t.user, c.id, await t.w.signTypedData(c.typedData))
    for (const view of [await service.detail(t.f.listing.id), (await service.list({})).items[0]]) {
      assert.equal(view.testnetPurchaseEligible, false)
      assert.equal(view.testnetPurchaseBlockReason, 'payout_unconfirmed')
    }
    await assert.rejects(t.create(), /STATE_CONFLICT/)
    assert.deepEqual(await t.payout.existingOrderTerms(t.f.buyer, id), original)
  } finally { await t.close() }
})
