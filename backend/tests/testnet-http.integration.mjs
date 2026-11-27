import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sandbox, fixture } from './helpers/database.mjs'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { LocalPaymentSigner } from '../dist/web3/payment-signer.js'
import { PostgresPaymentJournal } from '../dist/web3/payment-journal.js'
import { hashPassword } from '../dist/auth/password.js'
const origin = 'http://localhost:3000', password = 'Virtual-T03-http-password-only'

test('T03 HTTP: CSRF, dedicated payout, exact price snapshots and historical reads after disable', async () => {
  const db = await sandbox(), security = await isolatedLedger(), f = await fixture(db, 'digital', '10')
  let app, disabled
  try {
    await db.client.listing.update({ where: { id: f.listing.id }, data: { currency: 'CNY', category: 'digital_assets' } })
    await db.client.digitalInventory.create({ data: { listingId: f.listing.id } })
    for (const accountId of [f.seller, f.buyer]) await db.client.accountCredential.create({ data: {
      accountId, passwordHash: await hashPassword(password) } })
    const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin })
    config.web3 = { chainId: 11155111, tokenDecimals: 6, token: '0x' + '1'.repeat(40), escrow: '0x' + '2'.repeat(40),
      rpcPrimary: 'https://one.invalid', rpcSecondary: 'https://two.invalid', securityLedgerUrl: db.url.toString(), securityLedgerId: security.id }
    app = await createApp(config, false, { walletLedger: security.ledger, walletEoaCheck: async () => {},
      paymentSigner:new LocalPaymentSigner(generatePrivateKey(),'0x'+'a'.repeat(64)),
      paymentJournal:new PostgresPaymentJournal(security.client,security.id) })
    const post = (path, payload, headers = {}) => app.inject({ method: 'POST', url: '/api/' + path,
      headers: { origin, ...headers }, payload })
    const login = async id => {
      const a = await db.client.account.findUniqueOrThrow({ where: { id } })
      const r = await post('auth/login', { loginName: a.loginName, password })
      assert.equal(r.statusCode, 200, r.body)
      return { cookie: r.headers['set-cookie'].split(';')[0], 'x-csrf-token': r.json().csrfToken }
    }
    const seller = await login(f.seller), buyer = await login(f.buyer), w = privateKeyToAccount(generatePrivateKey())
    for (const purpose of ['bind', 'payout']) {
      const headers = { ...seller, 'idempotency-key': randomUUID() }
      const proof = await post('auth/wallet/reauth/password', { password, purpose, address: w.address }, headers)
      assert.equal(proof.statusCode, 200, proof.body)
      const c = await post('auth/wallet/challenge', { proofId: proof.json().id, purpose, address: w.address }, headers)
      assert.equal(c.statusCode, 200, c.body)
      const result = await post(purpose === 'bind' ? 'auth/wallet/consume' : 'web3/payout/confirm',
        { id: c.json().id, signature: await w.signTypedData(c.json().typedData) }, headers)
      assert.equal(result.statusCode, 200, result.body)
    }
    const buyerWallet=privateKeyToAccount(generatePrivateKey()), bh={...buyer,'idempotency-key':randomUUID()}
    const proof=await post('auth/wallet/reauth/password',{password,purpose:'bind',address:buyerWallet.address},bh)
    const bc=await post('auth/wallet/challenge',{proofId:proof.json().id,purpose:'bind',address:buyerWallet.address},bh)
    const br=await post('auth/wallet/consume',{id:bc.json().id,signature:await buyerWallet.signTypedData(bc.json().typedData)},bh)
    assert.equal(br.statusCode,200,br.body)
    const capabilities = await app.inject({ method: 'GET', url: '/api/web3/config' })
    assert.equal(capabilities.json().enabled, true)
    assert.equal(capabilities.json().currency, 'BZTEST')
    assert.equal('securityLedgerUrl' in capabilities.json(), false)
    assert.equal((await post(`web3/listings/${f.listing.id}/price`, { version: 1, amount: '1' }, { cookie: seller.cookie })).statusCode, 403)
    const changed = await post(`web3/listings/${f.listing.id}/price`, { version: 1, amount: '1.000001' }, seller)
    assert.equal(changed.statusCode, 200, changed.body)
    assert.equal(changed.json().testnetPrice.amountAtoms, '1000001')
    assert.equal(changed.json().price.amount, '10')
    const headers = { ...buyer, 'idempotency-key': randomUUID() }
    const created = await post('web3/orders', { listingId: f.listing.id, version: 2 }, headers)
    assert.equal(created.statusCode, 200, created.body)
    const id = created.json().orderId
    assert.equal((await post('web3/orders', { listingId: f.listing.id, version: 2 }, headers)).json().orderId, id)
    const terms = await post(`web3/orders/${id}/terms`, {}, buyer)
    assert.equal(terms.statusCode, 200, terms.body)
    assert.equal(terms.json().amountAtoms, '1000001')
    assert.equal(terms.json().sellerWallet, w.address.toLowerCase())
    assert.equal(terms.json().payment.buyer, buyerWallet.address.toLowerCase())
    assert.equal(terms.json().payment.orderId, created.json().permit.orderId)
    assert.equal(terms.json().intentId, created.json().intentId)
    const detail = await post(`orders/${id}`, {}, buyer)
    assert.equal(detail.json().settlementMode, 'testnet_escrow')
    assert.equal((await post(`orders/${id}/actions/pay`, {}, { ...buyer, 'idempotency-key': randomUUID() })).statusCode, 409)
    const expired = await new (await import('../dist/orders/order-commands.js')).OrderCommands(db.client)
      .expirePendingPaymentOrders(new Date(Date.now() + 86_400_000))
    assert.deepEqual(expired.expired, [])
    assert.equal((await db.client.order.findUniqueOrThrow({ where: { id } })).status, 'pending_payment')
    const foreign = await post('web3/orders', { listingId: f.listing.id, version: 2, sellerWallet: '0x' + 'f'.repeat(40) },
      { ...buyer, 'idempotency-key': randomUUID() })
    assert.equal(foreign.statusCode, 400)
    disabled = await createApp(readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin }), false)
    const historical = await disabled.inject({ method: 'POST', url: `/api/web3/orders/${id}/terms`, headers: { origin, ...buyer }, payload: {} })
    assert.equal(historical.statusCode, 200, historical.body)
    assert.deepEqual(historical.json(), terms.json())
  } finally { if (disabled) await disabled.close(); if (app) await app.close(); await db.close(); await security.close() }
})

test('A32: originating SIWE session can reconcile only its already committed payout with CSRF', async () => {
  const { DomainError } = await import('../dist/common/domain-error.js')
  const db = await sandbox(), security = await isolatedLedger(), f = await fixture(db, 'digital', '1')
  let app
  try {
    await db.client.accountCredential.create({ data: { accountId: f.seller, passwordHash: await hashPassword(password) } })
    const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: origin })
    config.web3 = { chainId: 11155111, tokenDecimals: 6, token: '0x' + '1'.repeat(40), escrow: '0x' + '2'.repeat(40),
      rpcPrimary: 'https://one.invalid', rpcSecondary: 'https://two.invalid', securityLedgerUrl: db.url.toString(), securityLedgerId: security.id }
    app = await createApp(config, false, { walletLedger: security.ledger, walletEoaCheck: async () => {} })
    const post = (path, payload, headers = {}, remoteAddress) => app.inject({ method: 'POST', url: '/api/' + path,
      headers: { origin, ...headers }, payload, ...(remoteAddress ? { remoteAddress } : {}) })
    const a = await db.client.account.findUniqueOrThrow({ where: { id: f.seller } })
    const passwordLogin = await post('auth/login', { loginName: a.loginName, password })
    const headers = { cookie: passwordLogin.headers['set-cookie'].split(';')[0],
      'x-csrf-token': passwordLogin.json().csrfToken, 'idempotency-key': randomUUID() }
    const w = privateKeyToAccount(generatePrivateKey())
    const proof = await post('auth/wallet/reauth/password', { purpose: 'bind', address: w.address, password }, headers)
    const c = await post('auth/wallet/challenge', { purpose: 'bind', address: w.address, proofId: proof.json().id }, headers)
    await post('auth/wallet/consume', { id: c.json().id, signature: await w.signTypedData(c.json().typedData) }, headers)
    const loginChallenge = (await post('auth/wallet/login/challenge', { address: w.address })).json()
    const signedIn = await post('auth/wallet/login/verify', { id: loginChallenge.id, message: loginChallenge.message,
      signature: await w.signMessage({ message: loginChallenge.message }) })
    assert.equal(signedIn.statusCode, 200, signedIn.body)
    const walletHeaders = { cookie: signedIn.headers['set-cookie'].split(';')[0],
      'x-csrf-token': signedIn.json().csrfToken, 'idempotency-key': randomUUID() }
    const payoutProof = await post('auth/wallet/reauth/password', { purpose: 'payout', address: w.address, password }, walletHeaders)
    const challenge = await post('auth/wallet/challenge', { purpose: 'payout', address: w.address, proofId: payoutProof.json().id }, walletHeaders)
    assert.equal(challenge.statusCode, 200, challenge.body)
    const body = { id: challenge.json().id, signature: await w.signTypedData(challenge.json().typedData) }
    const commit = security.ledger.commit.bind(security.ledger)
    let fail = true
    security.ledger.commit = async id => {
      if (fail) { fail = false; throw new DomainError('WALLET_UNAVAILABLE') }
      return commit(id)
    }
    assert.equal((await post('web3/payout/confirm', body, walletHeaders)).statusCode, 503)
    assert.equal((await post('auth/wallet/current', {}, walletHeaders)).statusCode, 503)
    const otherLogin = await post('auth/login', { loginName: a.loginName, password }, {}, '127.0.0.3')
    const otherHeaders = { cookie: otherLogin.headers['set-cookie'].split(';')[0], 'x-csrf-token': otherLogin.json().csrfToken }
    assert.equal((await post('web3/payout/reconcile', body, otherHeaders, '127.0.0.2')).statusCode, 401)
    assert.equal((await post('web3/payout/reconcile', { ...body, id: randomUUID() }, walletHeaders, '127.0.0.2')).statusCode, 503)
    assert.equal((await post('web3/payout/reconcile', { ...body, signature: '0x' + '0'.repeat(130) }, walletHeaders, '127.0.0.2')).statusCode, 401)
    assert.equal((await post('web3/payout/reconcile', body, { cookie: walletHeaders.cookie }, '127.0.0.2')).statusCode, 403)
    assert.equal((await post('auth/wallet/current', {}, walletHeaders)).statusCode, 503)
    const repaired = await post('web3/payout/reconcile', body, walletHeaders, '127.0.0.2')
    assert.equal(repaired.statusCode, 200, repaired.body)
    assert.equal((await post('auth/wallet/current', {}, walletHeaders)).statusCode, 200)
    assert.equal((await post('web3/payout/reconcile', body, walletHeaders, '127.0.0.2')).statusCode, 200)
    assert.equal(await db.client.sellerPayoutConfirmation.count(), 1)
  } finally { if (app) await app.close(); await db.close(); await security.close() }
})
