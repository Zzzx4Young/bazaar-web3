import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sandbox, fixture } from './helpers/database.mjs'
import { AuthService } from '../dist/auth/auth.service.js'
import { readConfig } from '../dist/config.js'
import { hashPassword } from '../dist/auth/password.js'
import { TransactionAttemptService } from '../dist/web3/transaction-attempt.js'
const hash = (n) => '0x' + n.toString(16).padStart(64, '0')
test('A08/A20 transaction hints are authorized/idempotent and unknown or replaced attempts cannot pay or cancel an order', async () => {
  const db = await sandbox()
  try {
    const f = await fixture(db, 'digital'),
      orderId = await db.market.create(f.buyer, randomUUID(), f.input)
    await db.client.order.update({
      where: { id: orderId },
      data: { settlementMode: 'testnet_escrow' }
    })
    await db.client.accountCredential.create({
      data: { accountId: f.buyer, passwordHash: await hashPassword('Virtual-T07-only') }
    })
    const account = await db.client.account.findUniqueOrThrow({ where: { id: f.buyer } }),
      auth = new AuthService(db.client, readConfig({ DATABASE_URL: db.url.toString() })),
      user = await auth.login(account.loginName, 'Virtual-T07-only', '127.0.0.1')
    let status = 'unknown',
      orphanedBlockHash
    const observer = {
      config: { chainId: 11155111, escrow: '0x' + '2'.repeat(40) },
      observeTransaction: async () => ({
        status,
        sender: '0x' + '3'.repeat(40),
        nonce: '1',
        ...(status === 'included' ? { blockHash: hash(90), height: '2' } : {}),
        orphanedBlockHash,
        businessConfirmation: false
      })
    }
    const service = new TransactionAttemptService(db.client, auth, observer),
      key = randomUUID()
    const first = await service.reportAttempt(user, orderId, hash(1), key)
    assert.equal((await service.reportAttempt(user, orderId, hash(1), key)).id, first.id)
    await assert.rejects(service.reportAttempt(user, orderId, hash(2), key), /IDEMPOTENCY_CONFLICT/)
    assert.equal((await service.refreshAttempt(user, first.id)).status, 'unknown')
    assert.equal(
      (await db.client.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      'pending_payment'
    )
    const second = await service.reportAttempt(user, orderId, hash(2), randomUUID())
    status = 'included'
    await service.refreshAttempt(user, second.id)
    assert.equal(
      (await db.client.transactionAttempt.findUniqueOrThrow({ where: { id: first.id } })).status,
      'replaced'
    )
    assert.equal(
      (await db.client.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      'pending_payment'
    )
    status = 'unknown'
    orphanedBlockHash = hash(90)
    await service.refreshAttempt(user, second.id)
    assert.equal((await db.client.chainObservation.findFirstOrThrow()).status, 'orphaned')
    assert.equal(
      (await db.client.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      'pending_payment'
    )
    await db.client.session.update({
      where: { tokenHash: user.tokenHash },
      data: { revokedAt: new Date() }
    })
    await assert.rejects(service.refreshAttempt(user, first.id), /UNAUTHENTICATED/)
  } finally {
    await db.close()
  }
})
test('T07 HTTP attempt routes enforce Origin, CSRF, session, idempotency and participant access', async () => {
  const { testnetFixture } = await import('./helpers/testnet.mjs')
  const { createApp } = await import('../dist/app.js')
  const t = await testnetFixture()
  let app
  try {
    const config = readConfig({ DATABASE_URL: t.db.url.toString() })
    const deployment = {
      deploymentBlock: '0',
      escrowCodeHash: hash(1),
      tokenCodeHash: hash(2),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    config.web3 = { ...t.config, chainDeployment: deployment }
    const chainObserver = {
      config: t.config,
      observeTransaction: async () => ({ status: 'unknown', businessConfirmation: false })
    }
    app = await createApp(config, false, {
      walletLedger: t.security.ledger,
      walletEoaCheck: async () => {},
      chainObserver
    })
    const orderId = await t.db.market.create(t.f.buyer, randomUUID(), t.f.input)
    await t.db.client.order.update({
      where: { id: orderId },
      data: { settlementMode: 'testnet_escrow' }
    })
    await t.db.client.accountCredential.create({
      data: { accountId: t.f.buyer, passwordHash: await hashPassword('Virtual-T07-http-only') }
    })
    const buyer = await t.db.client.account.findUniqueOrThrow({ where: { id: t.f.buyer } })
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.appOrigin },
      payload: { loginName: buyer.loginName, password: 'Virtual-T07-http-only' }
    })
    assert.equal(login.statusCode, 200, login.body)
    const headers = {
      origin: config.appOrigin,
      cookie: login.headers['set-cookie'].split(';')[0],
      'x-csrf-token': login.json().csrfToken,
      'idempotency-key': randomUUID()
    }
    const path = '/api/web3/orders/' + orderId + '/transaction-attempts'
    const report = (h) =>
      app.inject({ method: 'POST', url: path, headers: h, payload: { txHash: hash(10) } })
    assert.equal((await report({ ...headers, origin: 'https://evil.invalid' })).statusCode, 403)
    assert.equal((await report({ ...headers, 'x-csrf-token': '' })).statusCode, 403)
    assert.equal((await report({ ...headers, cookie: '' })).statusCode, 401)
    const first = await report(headers)
    assert.equal(first.statusCode, 200, first.body)
    assert.equal((await report(headers)).json().id, first.json().id)
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/web3/transaction-attempts/' + first.json().id + '/refresh',
      headers,
      payload: {}
    })
    assert.equal(refreshed.statusCode, 200, refreshed.body)
    assert.equal(refreshed.json().status, 'unknown')
    await t.db.client.transactionAttempt.update({
      where: { id: first.json().id },
      data: {
        status: 'finalized',
        observation: {
          snapshot: {
            height: '10',
            hash: hash(1),
            verifiedBy: [
              'https://rpc.invalid/PRIVATE_PROVIDER_KEY',
              'https://rpc2.invalid/PRIVATE_PROVIDER_KEY'
            ]
          },
          event: 'Deposited',
          businessConfirmation: false
        }
      }
    })
    const finalized = await app.inject({
      method: 'POST',
      url: '/api/web3/transaction-attempts/' + first.json().id + '/refresh',
      headers,
      payload: {}
    })
    assert.equal(finalized.statusCode, 200, finalized.body)
    assert.equal(finalized.body.includes('PRIVATE_PROVIDER_KEY'), false)
    assert.equal((await report(headers)).body.includes('PRIVATE_PROVIDER_KEY'), false)

    assert.equal(
      (await t.db.client.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      'pending_payment'
    )
  } finally {
    if (app) await app.close()
    await t.close()
  }
})
