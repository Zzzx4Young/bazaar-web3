import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { hashPassword } from '../dist/auth/password.js'
import { testnetFixture } from './helpers/testnet.mjs'
import { PaymentIntentService } from '../dist/web3/payment-intent.service.js'
import { LocalPaymentSigner } from '../dist/web3/payment-signer.js'
import { PostgresPaymentJournal } from '../dist/web3/payment-journal.js'

async function setup() {
  const t = await testnetFixture()
  await t.bind()
  await t.confirm()
  await t.price('1.000001')
  await t.db.client.accountCredential.create({
    data: { accountId: t.f.buyer, passwordHash: await hashPassword('Virtual-T04-buyer-password') }
  })
  const buyer = await t.db.client.account.findUniqueOrThrow({ where: { id: t.f.buyer } })
  const user = await t.auth.login(buyer.loginName, 'Virtual-T04-buyer-password', '127.0.0.3')
  const bw = privateKeyToAccount(generatePrivateKey()),
    key = randomUUID()
  const proof = await t.wallets.requestPasswordReauth(
    user,
    'Virtual-T04-buyer-password',
    'bind',
    bw.address,
    key,
    '127.0.0.3'
  )
  const c = await t.wallets.createActionChallenge(user, proof.id, 'bind', bw.address, key)
  await t.wallets.consumeActionChallenge(user, c.id, await bw.signTypedData(c.typedData))
  const signer = new LocalPaymentSigner(generatePrivateKey(), '0x' + 'a'.repeat(64))
  const journal = new PostgresPaymentJournal(t.security.client, t.security.id)
  let clock = Date.now(),
    timestamp = Math.floor(clock / 1000),
    state = 'None',
    revoked = false,
    available = true
  const observer = {
    async readIntent(permit) {
      if (!available) throw new Error('RPC unavailable')
      return {
        snapshot: {
          chainId: t.config.chainId,
          height: '10',
          hash: '0x' + 'b'.repeat(64),
          timestamp,
          verifiedBy: [t.config.rpcPrimary, t.config.rpcSecondary],
          verifiedAt: new Date(clock)
        },
        intentId: permit.intentId,
        orderId: permit.orderId,
        stockId: permit.stockId,
        orderState: state,
        intentRevoked: revoked,
        signerRevoked: false,
        orderTermsHash:
          state === 'None'
            ? null
            : (await t.db.client.paymentOrderTerms.findFirstOrThrow()).termsHash,
        stockGeneration: permit.stockGeneration,
        stockOccupant: state === 'None' ? '0x' + '0'.repeat(64) : permit.orderId
      }
    }
  }
  const service = new PaymentIntentService(
    t.db.client,
    t.auth,
    t.payout,
    t.security.ledger,
    journal,
    signer,
    observer,
    t.config,
    async () => {},
    () => new Date(clock)
  )
  return {
    ...t,
    sellerUser: t.user,
    user,
    bw,
    service,
    signer,
    journal,
    observer,
    setChain: (patch) => {
      timestamp = patch.timestamp ?? timestamp
      clock = Math.max(clock, timestamp * 1000)
      state = patch.state ?? state
      revoked = patch.revoked ?? revoked
      available = patch.available ?? available
    },
    advanceServer: (ms) => {
      clock += ms
    },
    create: (key = randomUUID(), options = {}) =>
      service.createOrder(user, key, { listingId: t.f.listing.id, version: 2 }, options)
  }
}

test('A04: concurrent issuance fixes one stock, order and permit before signing; retry preserves deadline', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      [a, b] = await Promise.all([t.create(key), t.create(key)])
    assert.deepEqual(a, b)
    assert.equal(a.permit.amountAtoms, '1000001')
    assert.equal(a.permit.refundAddress, t.bw.address.toLowerCase())
    assert.equal(await t.db.client.paymentIntent.count(), 1)
    assert.equal(await t.db.client.testnetStock.count(), 1)
    await assert.rejects(t.create(), /UNAVAILABLE|INVENTORY_CONFLICT/)
    assert.equal(a.permit.payDeadline - a.permit.issuedAt, 1800)
  } finally {
    await t.close()
  }
})

test('A04: committed reservation survives signer crash; recovery uses original intent and original deadline', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      sign = t.signer.sign.bind(t.signer)
    let calls = 0
    t.signer.sign = async (p) => {
      calls++
      assert.equal(await t.db.client.paymentIntent.count(), 1)
      assert.equal(await t.db.client.paymentOrderTerms.count(), 1)
      assert.equal(
        (
          await t.db.client.digitalInventory.findUniqueOrThrow({
            where: { listingId: t.f.listing.id }
          })
        ).availability,
        'reserved'
      )
      if (calls === 1) throw new Error('simulated crash after DB commit')
      return sign(p)
    }
    await assert.rejects(t.create(key), /simulated crash/)
    const before = await t.db.client.paymentIntent.findFirstOrThrow()
    const recovered = await t.create(key)
    assert.equal(recovered.intentId, before.id)
    assert.deepEqual(recovered.permit, before.permit)
    assert.equal(await t.db.client.paymentIntent.count(), 1)
    assert.equal(
      await t.security.client.$queryRaw`SELECT 1 FROM "PaymentLedgerIntent"`.then((x) => x.length),
      1
    )
  } finally {
    await t.close()
  }
})

test('A04: signature execution then response loss cannot create another valid permit', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      sign = t.signer.sign.bind(t.signer),
      signed = []
    t.signer.sign = async (p) => {
      const signature = await sign(p)
      signed.push({ p, signature })
      if (signed.length === 1) throw new Error('signature response lost')
      return signature
    }
    await assert.rejects(t.create(key), /signature response lost/)
    const restored = await t.create(key)
    assert.deepEqual(signed[0], signed[1])
    assert.equal(restored.signature, signed[0].signature)
    assert.deepEqual(await t.create(key), restored)
    assert.equal(signed.length, 2)
  } finally {
    await t.close()
  }
})

test('A05/A06: server expiry and cancel request retain stock; finalized deadline alone permits replacement', async () => {
  const t = await setup()
  try {
    const a = await t.create(),
      key = randomUUID()
    t.advanceServer(1900_000)
    await t.service.requestIntentCancel(t.user, a.intentId, key)
    await assert.rejects(t.service.reconcile(t.user, a.intentId), /STATE_CONFLICT/)
    await assert.rejects(
      t.service.replaceIntent(t.user, a.orderId, randomUUID(), a.intentId),
      /STATE_CONFLICT/
    )
    assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).activeOrderId, a.orderId)
    t.setChain({ timestamp: a.permit.payDeadline })
    assert.equal((await t.service.reconcile(t.user, a.intentId)).status, 'expired')
    const b = await t.service.replaceIntent(t.user, a.orderId, key, a.intentId)
    assert.notEqual(b.intentId, a.intentId)
    assert.equal(b.permit.buyer, a.permit.buyer)
    assert.equal(b.permit.stockId, a.permit.stockId)
    assert.equal(b.permit.stockGeneration, a.permit.stockGeneration)
    assert.deepEqual(await t.service.replaceIntent(t.user, a.orderId, key, a.intentId), b)
    assert.equal(await t.db.client.paymentIntent.count(), 2)
  } finally {
    await t.close()
  }
})

test('A31: seller repricing and rebinding block new sale but do not rewrite old-order replacement', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    await t.price('9.123456')
    await t.bind(privateKeyToAccount(generatePrivateKey()))
    await assert.rejects(t.create(randomUUID()), /LISTING_CONFLICT|STATE_CONFLICT/)
    t.setChain({ revoked: true })
    await t.service.reconcile(t.user, a.intentId)
    const b = await t.service.replaceIntent(t.user, a.orderId, randomUUID(), a.intentId)
    for (const k of [
      'buyer',
      'seller',
      'refundAddress',
      'token',
      'amountAtoms',
      'stockId',
      'stockGeneration',
      'previousOrderId',
      'commitmentHash'
    ])
      assert.equal(b.permit[k], a.permit[k], k)
    assert.equal(b.permit.amountAtoms, '1000001')
  } finally {
    await t.close()
  }
})

test('A05: deposit wins cancellation race; finalized funded order cannot replace or release stock', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    await t.service.requestIntentCancel(t.user, a.intentId, randomUUID())
    t.setChain({ state: 'Funded', revoked: false })
    assert.equal((await t.service.reconcile(t.user, a.intentId)).status, 'funded')
    await assert.rejects(
      t.service.replaceIntent(t.user, a.orderId, randomUUID(), a.intentId),
      /STATE_CONFLICT/
    )
    await assert.rejects(t.service.closeOrder(t.user, a.orderId, randomUUID()), /STATE_CONFLICT/)
    assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).state, 'reserved')
  } finally {
    await t.close()
  }
})

test('A06: cancel wins; finalized revocation allows safe close and same stable stock for a new order', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    t.setChain({ revoked: true })
    await t.service.reconcile(t.user, a.intentId)
    await t.service.closeOrder(t.user, a.orderId, randomUUID())
    const b = await t.create()
    assert.equal(b.permit.stockId, a.permit.stockId)
    assert.equal(b.permit.stockGeneration, a.permit.stockGeneration)
    assert.notEqual(b.orderId, a.orderId)
  } finally {
    await t.close()
  }
})

test('A04/A20: missing signing records, unavailable ledger or RPC retain protection; revoked sessions cannot replay', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      a = await t.create(key)
    t.setChain({ available: false })
    await assert.rejects(t.service.reconcile(t.user, a.intentId), /WALLET_UNAVAILABLE/)
    await assert.rejects(
      t.service.closeOrder(t.user, a.orderId, randomUUID()),
      /STATE_CONFLICT|WALLET_UNAVAILABLE/
    )
    assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).activeOrderId, a.orderId)
    await t.security.client.$executeRaw`UPDATE "WalletLedgerMeta" SET "maintenance"=true`
    await assert.rejects(t.create(key), /WALLET_UNAVAILABLE/)
    await t.security.client.$executeRaw`UPDATE "WalletLedgerMeta" SET "maintenance"=false`
    // Model a Node/DB wall-clock skew without changing either system clock.
    await t.db.client
      .$executeRaw`UPDATE "Session" SET "createdAt"=GREATEST("createdAt",clock_timestamp()+interval '5 seconds') WHERE "tokenHash"=${t.user.tokenHash}`
    await t.db.client
      .$executeRaw`UPDATE "Session" SET "revokedAt"=GREATEST(clock_timestamp(),"createdAt") WHERE "tokenHash"=${t.user.tokenHash}`
    await assert.rejects(t.create(key), /UNAUTHENTICATED/)
    assert.equal(await t.db.client.paymentIntent.count(), 1)
  } finally {
    await t.close()
  }
})

test('A04: business rollback cannot make an independently retired intent signable again', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    t.setChain({ revoked: true })
    await t.service.reconcile(t.user, a.intentId)
    const b = await t.service.replaceIntent(t.user, a.orderId, randomUUID(), a.intentId)
    // Restore the pre-replacement business projection while retaining the newer independent ledger.
    await t.db.client.paymentIntentRequest.deleteMany({ where: { intentId: b.intentId } })
    await t.db.client.paymentSignature.deleteMany({ where: { intentId: b.intentId } })
    await t.db.client.paymentIntentState.delete({ where: { intentId: b.intentId } })
    await t.db.client.paymentIntent.delete({ where: { id: b.intentId } })
    await t.db.client.paymentIntentState.update({
      where: { intentId: a.intentId },
      data: { status: 'issued', verification: null }
    })
    await assert.rejects(t.service.read(t.user, a.intentId), /WALLET_UNAVAILABLE/)
    assert.equal(b.permit.stockId, a.permit.stockId)
  } finally {
    await t.close()
  }
})

test('A04: concurrent replacement keys produce one new permit; wrong actors and inconsistent evidence are rejected', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    t.setChain({ revoked: true })
    await t.service.reconcile(t.user, a.intentId)
    const results = await Promise.allSettled([
      t.service.replaceIntent(t.user, a.orderId, randomUUID(), a.intentId),
      t.service.replaceIntent(t.user, a.orderId, randomUUID(), a.intentId)
    ])
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1)
    assert.equal(await t.db.client.paymentIntent.count(), 2)
    const next = results.find((x) => x.status === 'fulfilled').value
    const observe = t.observer.readIntent.bind(t.observer)
    t.observer.readIntent = async (p) => ({
      ...(await observe(p)),
      snapshot: {
        ...(await observe(p)).snapshot,
        verifiedBy: [t.config.rpcPrimary, t.config.rpcPrimary]
      }
    })
    await assert.rejects(t.service.reconcile(t.user, next.intentId), /WALLET_UNAVAILABLE/)
    assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).activeOrderId, a.orderId)
  } finally {
    await t.close()
  }
})

test('A20: unauthorized reconcile cannot change another buyer intent into reconciling', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    await assert.rejects(t.service.reconcile(t.sellerUser, a.intentId), /NOT_FOUND/)
    assert.equal(
      (await t.db.client.paymentIntentState.findUniqueOrThrow({ where: { intentId: a.intentId } }))
        .status,
      'issued'
    )
    await assert.rejects(t.service.read(t.sellerUser, a.intentId), /NOT_FOUND/)
  } finally {
    await t.close()
  }
})

test('A04: cancellation after business commit but before journal commit can still recover safely', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      authorize = t.journal.authorize.bind(t.journal)
    t.journal.authorize = async () => {
      throw new Error('journal connection lost before acknowledgement')
    }
    await assert.rejects(t.create(key), /journal connection/)
    t.journal.authorize = authorize
    const i = await t.db.client.paymentIntent.findFirstOrThrow()
    await t.service.requestIntentCancel(t.user, i.id, randomUUID())
    t.setChain({ timestamp: i.permit.payDeadline })
    assert.equal((await t.service.reconcile(t.user, i.id)).status, 'expired')
    await t.service.closeOrder(t.user, i.orderId, randomUUID())
    assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).state, 'free')
  } finally {
    await t.close()
  }
})

test('A20 HTTP: origin, CSRF, exact payload, actor and revoked-session checks precede permit replay', async () => {
  const t = await setup(),
    { createApp } = await import('../dist/app.js'),
    { readConfig } = await import('../dist/config.js')
  let app
  try {
    const config = readConfig({
      DATABASE_URL: t.db.url.toString(),
      APP_ORIGIN: 'http://localhost:3000'
    })
    config.web3 = t.config
    app = await createApp(config, false, {
      walletLedger: t.security.ledger,
      walletEoaCheck: async () => {},
      paymentSigner: t.signer,
      paymentJournal: t.journal,
      paymentObserver: t.observer
    })
    const headers = {
      origin: 'http://localhost:3000',
      cookie: t.auth.cookie(t.user.token).split(';')[0],
      'x-csrf-token': t.auth.view(t.user).csrfToken,
      'idempotency-key': randomUUID()
    }
    const post = (path, body = {}, h = headers) =>
      app.inject({ method: 'POST', url: '/api/web3/' + path, headers: h, payload: body })
    const created = await post('orders', { listingId: t.f.listing.id, version: 2 })
    assert.equal(created.statusCode, 200, created.body)
    const a = created.json(),
      path = 'payment-intents/' + a.intentId
    assert.equal(a.permit.refundAddress, t.bw.address.toLowerCase())
    assert.equal(a.signature.length, 132)
    assert.equal(
      (await post(path + '/read', {}, { ...headers, origin: 'https://evil.invalid' })).statusCode,
      403
    )
    const noCsrf = { ...headers }
    delete noCsrf['x-csrf-token']
    assert.equal((await post(path + '/read', {}, noCsrf)).statusCode, 403)
    assert.equal(
      (
        await post('orders/' + a.orderId + '/payment-intents/replace', {
          previousIntentId: a.intentId,
          buyer: '0x' + 'f'.repeat(40)
        })
      ).statusCode,
      400
    )
    assert.equal((await post(path + '/cancel')).json().status, 'cancellation_pending')
    const pending = await post(path + '/reconcile')
    assert.equal(pending.statusCode, 409, pending.body)
    assert.equal(pending.json().code, 'STATE_CONFLICT')
    await t.db.client.session.update({
      where: { tokenHash: t.user.tokenHash },
      data: { revokedAt: new Date() }
    })
    assert.equal((await post(path + '/read')).statusCode, 401)
    assert.equal(await t.db.client.paymentIntent.count(), 1)
  } finally {
    if (app) await app.close()
    await t.close()
  }
})

test('T04 runtime roles can issue immutable permits but cannot rewrite stock identity or issuance history', async () => {
  const t = await setup(),
    { connect, testUrl } = await import('./helpers/database.mjs')
  const { grantRuntime } = await import('../scripts/runtime-grants.mjs'),
    { grantWalletLedger } = await import('../scripts/wallet-ledger-grants.mjs')
  const { PostgresWalletSecurityLedger } =
    await import('../dist/auth/postgres-wallet-security-ledger.js')
  const { AuthService } = await import('../dist/auth/auth.service.js'),
    { SellerPayoutService } = await import('../dist/web3/seller-payout.service.js')
  const { readConfig } = await import('../dist/config.js'),
    admin = await connect(testUrl()),
    roles = [],
    connections = []
  try {
    const [{ schema }] = await t.security.client.$queryRaw`SELECT current_schema() AS schema`
    for (const target of ['business', 'ledger']) {
      const role = 't04_' + randomUUID().replaceAll('-', ''),
        password = randomUUID()
      roles.push(role)
      await admin.client.$executeRawUnsafe(
        `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
      )
      if (target === 'business') await grantRuntime(t.db.client, t.db.schema, role)
      else await grantWalletLedger(t.security.client, schema, role)
      const url = new URL(t.db.url)
      url.username = role
      url.password = password
      url.searchParams.set('schema', target === 'business' ? t.db.schema : schema)
      connections.push(await connect(url))
    }
    const client = connections[0].client,
      ledger = new PostgresWalletSecurityLedger(connections[1].client, t.security.id)
    const auth = new AuthService(client, readConfig({ DATABASE_URL: t.db.url.toString() }), ledger)
    const payout = new SellerPayoutService(client, t.wallets, ledger, t.config)
    const service = new PaymentIntentService(
      client,
      auth,
      payout,
      ledger,
      new PostgresPaymentJournal(connections[1].client, t.security.id),
      t.signer,
      t.observer,
      t.config,
      async () => {}
    )
    const a = await service.createOrder(t.user, randomUUID(), {
      listingId: t.f.listing.id,
      version: 2
    })
    assert.ok(a.signature)
    await assert.rejects(
      client.paymentIntent.update({
        where: { id: a.intentId },
        data: { digest: '0x' + 'f'.repeat(64) }
      }),
      /permission denied/
    )
    await assert.rejects(
      client.testnetStock.update({
        where: { listingId: t.f.listing.id },
        data: { stockId: '0x' + 'f'.repeat(64) }
      }),
      /permission denied/
    )
    await assert.rejects(
      connections[1].client.$executeRaw`DELETE FROM "PaymentLedgerIntent"`,
      /permission denied/
    )
  } finally {
    for (const c of connections) await c.onModuleDestroy()
    await t.close()
    for (const role of roles) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
  }
})

test('A04: two concurrent distinct order keys cannot reserve or sign the same inventory twice', async () => {
  const t = await setup()
  try {
    const results = await Promise.allSettled([t.create(), t.create()])
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1)
    assert.equal(await t.db.client.order.count(), 1)
    assert.equal(await t.db.client.paymentIntent.count(), 1)
    assert.equal(await t.db.client.paymentSignature.count(), 1)
  } finally {
    await t.close()
  }
})

test('A04: independently committed invalidation survives a failed business projection and exact retry repairs it', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    t.setChain({ revoked: true })
    const resolve = t.journal.resolve.bind(t.journal)
    let fail = true
    t.journal.resolve = async (...args) => {
      await resolve(...args)
      if (fail) {
        fail = false
        throw new Error('business commit lost after independent resolution')
      }
    }
    await assert.rejects(t.service.reconcile(t.user, a.intentId), /WALLET_UNAVAILABLE/)
    assert.equal(
      (await t.db.client.paymentIntentState.findUniqueOrThrow({ where: { intentId: a.intentId } }))
        .status,
      'reconciling'
    )
    assert.equal((await t.service.reconcile(t.user, a.intentId)).status, 'revoked')
    assert.equal(
      await t.security.client.$queryRaw`SELECT 1 FROM "PaymentLedgerResolution"`.then(
        (x) => x.length
      ),
      1
    )
  } finally {
    await t.close()
  }
})

test('A04: legacy snapshot without committed payment basis stays reserved and cannot acquire a permit', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      input = { listingId: t.f.listing.id, version: 2, settlementMode: 'testnet_escrow' }
    const id = await t.orders.create(t.f.buyer, key, input)
    await assert.rejects(t.service.createOrder(t.user, key, input), /WALLET_UNAVAILABLE/)
    assert.equal(
      (
        await t.db.client.digitalInventory.findUniqueOrThrow({
          where: { listingId: t.f.listing.id }
        })
      ).activeOrderId,
      id
    )
    assert.equal(await t.db.client.paymentSignature.count(), 0)
    assert.equal(await t.db.client.paymentIntent.count(), 0)
  } finally {
    await t.close()
  }
})

test('A04 review: reconcile-first after initial journal failure recovers original intent without locking stock forever', async () => {
  const t = await setup()
  try {
    const key = randomUUID(),
      authorize = t.journal.authorize.bind(t.journal)
    t.journal.authorize = async () => {
      throw new Error('journal unavailable before initial commit')
    }
    await assert.rejects(t.create(key), /journal unavailable/)
    const i = await t.db.client.paymentIntent.findFirstOrThrow()
    t.setChain({ timestamp: i.permit.payDeadline })
    await assert.rejects(
      t.service.reconcile(t.user, i.id),
      /WALLET_UNAVAILABLE|journal unavailable/
    )
    assert.equal(
      (await t.db.client.paymentIntentState.findUniqueOrThrow({ where: { intentId: i.id } }))
        .status,
      'issued'
    )
    t.journal.authorize = authorize
    assert.equal((await t.service.reconcile(t.user, i.id)).status, 'expired')
    await t.service.closeOrder(t.user, i.orderId, randomUUID())
    assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).state, 'free')
    assert.equal(await t.db.client.paymentIntent.count(), 1)
    assert.equal(await t.db.client.paymentSignature.count(), 0)
  } finally {
    await t.close()
  }
})

test('A14/A31: buyer rebinding does not rewrite the original payer or refund wallet on replacement', async () => {
  const t = await setup()
  try {
    const a = await t.create(),
      next = privateKeyToAccount(generatePrivateKey()),
      key = randomUUID()
    const proof = await t.wallets.requestPasswordReauth(
      t.user,
      'Virtual-T04-buyer-password',
      'bind',
      next.address,
      key,
      '127.0.0.3'
    )
    const challenge = await t.wallets.createActionChallenge(
      t.user,
      proof.id,
      'bind',
      next.address,
      key
    )
    await t.wallets.consumeActionChallenge(
      t.user,
      challenge.id,
      await next.signTypedData(challenge.typedData)
    )
    t.setChain({ revoked: true })
    await t.service.reconcile(t.user, a.intentId)
    const b = await t.service.replaceIntent(t.user, a.orderId, randomUUID(), a.intentId)
    assert.equal(b.permit.buyer, a.permit.buyer)
    assert.equal(b.permit.refundAddress, a.permit.refundAddress)
    assert.notEqual(b.permit.buyer, next.address.toLowerCase())
  } finally {
    await t.close()
  }
})

test('A04: changed buyer or stock tuple cannot pass the independent signing history even after business-row tampering', async () => {
  const t = await setup()
  try {
    const a = await t.create(),
      original = await t.db.client.paymentOrderTerms.findUniqueOrThrow({
        where: { orderId: a.orderId }
      })
    const { paymentDigest, orderTermsDigest } = await import('../dist/web3/payment-signer.js')
    const changedBuyer = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
    let signs = 0
    const sign = t.signer.sign.bind(t.signer)
    t.signer.sign = async (p) => {
      signs++
      return sign(p)
    }
    for (const change of [
      { buyer: changedBuyer, refundAddress: changedBuyer },
      { stockId: '0x' + 'e'.repeat(64) }
    ]) {
      const terms = { ...original.terms, ...change },
        permit = { ...a.permit, ...change }
      await t.db.client.$transaction(async (tx) => {
        if (change.stockId)
          await tx.testnetStock.update({
            where: { listingId: t.f.listing.id },
            data: { stockId: change.stockId }
          })
        await tx.paymentOrderTerms.update({
          where: { orderId: a.orderId },
          data: { stockId: terms.stockId, terms, termsHash: orderTermsDigest(terms) }
        })
        await tx.paymentIntent.update({
          where: { id: a.intentId },
          data: { permit, digest: paymentDigest(permit) }
        })
      })
      await assert.rejects(t.service.read(t.user, a.intentId), /WALLET_UNAVAILABLE/)
    }
    assert.equal(signs, 0)
    assert.equal((await t.db.client.digitalInventory.findFirstOrThrow()).activeOrderId, a.orderId)
  } finally {
    await t.close()
  }
})

test('A20: account suspension after authentication cannot cause a late cancellation state change', async () => {
  const t = await setup()
  try {
    const a = await t.create(),
      authenticate = t.auth.authenticate.bind(t.auth)
    let suspended = false
    t.auth.authenticate = async (cookie) => {
      const result = await authenticate(cookie)
      if (!suspended) {
        suspended = true
        await t.db.client.account.update({ where: { id: t.f.buyer }, data: { status: 'disabled' } })
      }
      return result
    }
    await assert.rejects(
      t.service.requestIntentCancel(t.user, a.intentId, randomUUID()),
      /UNAUTHENTICATED|FORBIDDEN/
    )
    assert.equal(
      (await t.db.client.paymentIntentState.findUniqueOrThrow({ where: { intentId: a.intentId } }))
        .status,
      'issued'
    )
    assert.equal(await t.db.client.paymentIntentRequest.count(), 0)
  } finally {
    await t.close()
  }
})

test('T07 recovery gate blocks existing permit reads and new reservation without changing signed history', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    const signatureCount = await t.db.client.paymentSignature.count()
    t.config.chainDeployment = {
      deploymentBlock: '0',
      escrowCodeHash: '0x' + '1'.repeat(64),
      tokenCodeHash: '0x' + '2'.repeat(64),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    await assert.rejects(t.service.read(t.user, a.intentId), /WALLET_UNAVAILABLE/)
    assert.equal(await t.db.client.paymentSignature.count(), signatureCount)
    assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).activeOrderId, a.orderId)
  } finally {
    await t.close()
  }
})
test('T07 paused finalized projection blocks re-signing but preserves existing cancellation authority', async () => {
  const t = await setup()
  try {
    const a = await t.create()
    t.config.chainDeployment = {
      deploymentBlock: '0',
      escrowCodeHash: '0x' + '1'.repeat(64),
      tokenCodeHash: '0x' + '2'.repeat(64),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    const { EscrowProjector } = await import('../dist/web3/escrow-projector.js')
    const p = new EscrowProjector(t.db.client, t.config, t.config.chainDeployment)
    await p.initialize('recovery')
    await t.db.client.scanCheckpoint.update({
      where: { scope: p.scope },
      data: { height: 1n, status: 'active', globals: { paused: true } }
    })
    await t.db.client.paymentSignature.delete({ where: { intentId: a.intentId } })
    await assert.rejects(t.service.read(t.user, a.intentId), /WALLET_UNAVAILABLE/)
  } finally {
    await t.close()
  }
})
test('T07 independent issuance basis cannot be reconstructed from an empty or corrupted business projection', async () => {
  const { sandbox } = await import('./helpers/database.mjs')
  const t = await setup()
  let restored
  try {
    const a = await t.create(),
      scope = t.config.chainId + ':' + t.config.escrow
    await t.journal.assertBusinessBasis(t.db.client, scope)
    restored = await sandbox()
    await assert.rejects(
      t.journal.assertBusinessBasis(restored.client, scope),
      /WALLET_UNAVAILABLE/
    )
    await t.db.client.paymentIntent.update({
      where: { id: a.intentId },
      data: { digest: '0x' + '9'.repeat(64) }
    })
    await assert.rejects(t.journal.assertBusinessBasis(t.db.client, scope), /WALLET_UNAVAILABLE/)
  } finally {
    if (restored) await restored.close()
    await t.close()
  }
})
test('T07 review: independent issuance coverage paginates past 2048 retained records', async () => {
  const { paymentDigest } = await import('../dist/web3/payment-signer.js')
  const { keccak256, stringToHex } = await import('viem')
  const t = await setup()
  try {
    const a = await t.create(),
      [original] = await t.security.client
        .$queryRaw`SELECT * FROM "PaymentLedgerIntent" WHERE "id"=${a.intentId}::uuid`
    const rows = Array.from({ length: 2048 }, () => {
      const id = randomUUID(),
        permit = { ...a.permit, intentId: keccak256(stringToHex(id)) }
      return { id, permit, digest: paymentDigest(permit) }
    })
    await t.db.client.paymentIntent.createMany({
      data: rows.map((r) => ({ ...r, orderId: a.orderId, previousIntentId: a.intentId }))
    })
    await t.security.client
      .$executeRaw`INSERT INTO "PaymentLedgerIntent" ("id","orderId","listingId","stockId","scope","digest","termsHash","recoveryEpoch","permit","previousIntentId") SELECT j.id::uuid,${original.orderId}::uuid,${original.listingId}::uuid,${original.stockId},${original.scope},j.digest,${original.termsHash},${original.recoveryEpoch}::uuid,j.permit,${a.intentId}::uuid FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS j(id text,digest text,permit jsonb)`
    await t.journal.assertBusinessBasis(t.db.client, original.scope)
    assert.equal(await t.db.client.paymentIntent.count(), 2049)
  } finally {
    await t.close()
  }
})
test('T07 review: independent accepted invalidity prevents a restored index from reviving cancelled funds', async () => {
  const { EscrowProjector } = await import('../dist/web3/escrow-projector.js')
  const t = await setup()
  try {
    const a = await t.create(),
      p = a.permit
    const preflight = await t.journal.assertResolutions(
      {
        snapshot: {
          chainId: t.config.chainId,
          height: '0',
          hash: '0x' + '0'.repeat(64),
          timestamp: p.issuedAt,
          verifiedBy: [t.config.rpcPrimary, t.config.rpcSecondary],
          verifiedAt: new Date()
        },
        events: []
      },
      { config: t.config }
    )
    t.setChain({ revoked: true, timestamp: p.payDeadline })
    await t.service.reconcile(t.user, a.intentId)
    await t.service.closeOrder(t.user, a.orderId, randomUUID())
    assert.equal(
      (await t.db.client.order.findUniqueOrThrow({ where: { id: a.orderId } })).status,
      'cancelled'
    )
    const [resolution] = await t.security.client
      .$queryRaw`SELECT "evidence" FROM "PaymentLedgerResolution" WHERE "intentId"=${a.intentId}::uuid`
    const h = (n) => '0x' + n.toString(16).padStart(64, '0'),
      termsHash = (
        await t.db.client.paymentOrderTerms.findUniqueOrThrow({ where: { orderId: a.orderId } })
      ).termsHash
    const amount = p.amountAtoms,
      order = {
        orderId: p.orderId,
        state: 'Funded',
        buyer: p.buyer,
        refundAddress: p.refundAddress,
        seller: p.seller,
        amountAtoms: amount,
        stockId: p.stockId,
        generation: p.stockGeneration,
        fundedAt: String(p.issuedAt + 1),
        deliveredAt: '0',
        disputedAt: '0',
        credentialId: h(0),
        deliveryVersion: h(0),
        manifestCommitment: h(0),
        termsHash
      }
    const r = {
      from: '0',
      snapshot: {
        ...resolution.evidence.snapshot,
        height: '5',
        hash: h(105),
        timestamp: p.issuedAt + 5,
        verifiedAt: new Date()
      },
      blocks: Array.from({ length: 6 }, (_, n) => ({
        height: String(n),
        hash: h(100 + n),
        parentHash: h(99 + n),
        timestamp: p.issuedAt + n
      })),
      events: [
        {
          name: 'Deposited',
          args: {
            orderId: p.orderId,
            intentId: p.intentId,
            stockId: p.stockId,
            generation: p.stockGeneration,
            buyer: p.buyer,
            refundAddress: p.refundAddress,
            seller: p.seller,
            token: p.token,
            amountAtoms: amount,
            timestamp: String(p.issuedAt + 1),
            deliveryDeadline: String(p.issuedAt + 1 + 259200),
            termsHash
          },
          height: '1',
          blockHash: h(101),
          txHash: h(201),
          txIndex: '0',
          logIndex: '0'
        }
      ],
      orders: [order],
      stocks: [{ stockId: p.stockId, occupant: p.orderId, generation: p.stockGeneration }],
      globals: {
        outstanding: amount,
        totalDeposited: amount,
        totalPaid: '0',
        balance: amount,
        paused: false
      }
    }
    const deployment = {
      deploymentBlock: '0',
      escrowCodeHash: h(1),
      tokenCodeHash: h(2),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    const observer = {
      config: t.config,
      readVerifiedSnapshot: async () => resolution.evidence.snapshot,
      atHeight: async () => resolution.evidence.snapshot,
      readIntent: async () => ({
        ...resolution.evidence,
        orderState: 'Funded',
        orderTermsHash: termsHash,
        stockOccupant: p.orderId
      })
    }
    const stale = new EscrowProjector(t.db.client, t.config, deployment, async () => preflight)
    await stale.initialize('recovery')
    await assert.rejects(stale.project(r), (e) => e.kind === 'unavailable')
    assert.equal(await t.db.client.escrowProjection.count(), 0)
    const projector = new EscrowProjector(t.db.client, t.config, deployment, (range) =>
      t.journal.assertResolutions(range, observer)
    )
    await assert.rejects(projector.project(r), (e) => e.kind === 'contradiction')
    assert.equal(
      (await t.db.client.order.findUniqueOrThrow({ where: { id: a.orderId } })).status,
      'cancelled'
    )
    assert.equal((await t.db.client.scanCheckpoint.findFirstOrThrow()).status, 'isolated')
  } finally {
    await t.close()
  }
})
