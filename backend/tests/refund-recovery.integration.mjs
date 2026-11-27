import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { keccak256, stringToHex } from 'viem'
import { testnetFixture } from './helpers/testnet.mjs'
import { orderTermsDigest, paymentDigest } from '../dist/web3/payment-signer.js'
import { PostgresPaymentJournal } from '../dist/web3/payment-journal.js'
import { chainScope, deploymentDigest } from '../dist/web3/escrow-projector.js'
const implementation = await import('../dist/web3/refund-recovery.service.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const ledgerImplementation = await import('../dist/web3/refund-journal.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const h = (n) => '0x' + n.toString(16).padStart(64, '0'),
  id = (kind, value) => keccak256(stringToHex('bazaar:' + kind + ':' + value))
export async function setupRefund(securityOptions = {}) {
  assert.equal(
    typeof implementation.RefundRecoveryService,
    'function',
    'T08-R recovery service required'
  )
  const t = await testnetFixture({}, securityOptions)
  try {
    await t.bind()
    await t.confirm()
    await t.price('1.000001')
    const orderId = await t.create(),
      intentId = randomUUID()
    const deployment = {
      deploymentBlock: '0',
      escrowCodeHash: h(1),
      tokenCodeHash: h(2),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    const config = { ...t.config, chainDeployment: deployment },
      scope = chainScope(config),
      fundedAt = 1700000000
    const terms = {
      orderId: id('order', orderId),
      stockId: h(20),
      stockGeneration: '0',
      previousOrderId: h(0),
      chainId: config.chainId,
      token: config.token,
      escrow: config.escrow,
      seller: t.w.address.toLowerCase(),
      buyer: '0x' + '5'.repeat(40),
      refundAddress: '0x' + '5'.repeat(40),
      amountAtoms: '1000001',
      commitmentHash: h(40)
    }
    const permit = {
      ...terms,
      schemaVersion: 1,
      intentId: id('intent', intentId),
      issuedAt: fundedAt - 1,
      payDeadline: fundedAt - 1 + 1800,
      signerKeyId: h(50)
    }
    const record = {
      id: intentId,
      orderId,
      listingId: t.f.listing.id,
      stockId: terms.stockId,
      scope,
      digest: paymentDigest(permit),
      termsHash: orderTermsDigest(terms),
      recoveryEpoch: t.security.epoch,
      permit,
      previousIntentId: null
    }
    await t.db.client.$transaction(async (tx) => {
      await tx.testnetStock.create({
        data: {
          listingId: t.f.listing.id,
          stockId: terms.stockId,
          generation: '0',
          previousOrderId: h(0),
          activeOrderId: orderId,
          lastOrderId: orderId,
          state: 'protected'
        }
      })
      await tx.paymentOrderTerms.create({
        data: {
          orderId,
          listingId: t.f.listing.id,
          stockId: terms.stockId,
          terms,
          termsHash: record.termsHash,
          recoveryEpoch: t.security.epoch,
          initialIntentId: intentId
        }
      })
      await tx.paymentIntent.create({
        data: { id: intentId, orderId, permit, digest: record.digest }
      })
      await tx.paymentIntentState.create({ data: { intentId, orderId, status: 'funded' } })
      await tx.order.update({ where: { id: orderId }, data: { status: 'refunded' } })
    })
    const journal = new PostgresPaymentJournal(t.security.client, t.security.id)
    await journal.authorize(record)
    const snapshot = {
      chainId: config.chainId,
      height: '200',
      hash: h(200),
      timestamp: fundedAt + 259210,
      verifiedBy: [config.rpcPrimary, config.rpcSecondary],
      verifiedAt: new Date()
    }
    const order = {
      orderId: terms.orderId,
      state: 'Refunded',
      buyer: terms.buyer,
      refundAddress: terms.buyer,
      seller: terms.seller,
      amountAtoms: terms.amountAtoms,
      stockId: terms.stockId,
      generation: '0',
      fundedAt: String(fundedAt),
      deliveredAt: '0',
      disputedAt: '0',
      credentialId: h(0),
      deliveryVersion: h(0),
      manifestCommitment: h(0),
      termsHash: record.termsHash
    }
    const event = (name, height, args) => ({
      name,
      args,
      height: String(height),
      blockHash: h(height),
      txHash: h(height + 1000),
      txIndex: '0',
      logIndex: '0'
    })
    const deposit = event('Deposited', 10, {
      orderId: terms.orderId,
      intentId: permit.intentId,
      stockId: terms.stockId,
      generation: '0',
      buyer: terms.buyer,
      refundAddress: terms.buyer,
      seller: terms.seller,
      token: terms.token,
      amountAtoms: terms.amountAtoms,
      timestamp: String(fundedAt),
      deliveryDeadline: String(fundedAt + 259200),
      termsHash: record.termsHash
    })
    const refund = event('Refunded', 190, {
      orderId: terms.orderId,
      recipient: terms.buyer,
      token: terms.token,
      amountAtoms: terms.amountAtoms,
      timestamp: String(fundedAt + 259200),
      reason: '2',
      reasonCommitment: h(0)
    })
    const globals = {
      outstanding: '0',
      totalDeposited: terms.amountAtoms,
      totalPaid: terms.amountAtoms,
      balance: '0',
      paused: false
    }
    await t.db.client.scanCheckpoint.create({
      data: {
        scope,
        configHash: deploymentDigest(config, deployment),
        deploymentBlock: 0n,
        height: 200n,
        hash: snapshot.hash,
        status: 'active',
        globals
      }
    })
    await t.db.client.chainBlock.create({
      data: {
        scope,
        height: 200n,
        hash: snapshot.hash,
        parentHash: h(199),
        timestamp: BigInt(snapshot.timestamp)
      }
    })
    await t.db.client.chainSnapshot.create({
      data: {
        scope,
        height: 200n,
        hash: snapshot.hash,
        ordersHash: 'a'.repeat(64),
        stocksHash: 'b'.repeat(64),
        globals
      }
    })
    await t.db.client.escrowProjection.create({
      data: {
        scope,
        chainOrderId: terms.orderId,
        businessOrderId: orderId,
        state: 'Refunded',
        stockId: terms.stockId,
        amountAtoms: terms.amountAtoms,
        data: order,
        height: 200n,
        blockHash: snapshot.hash
      }
    })
    await t.db.client.chainStockProjection.create({
      data: {
        scope,
        stockId: terms.stockId,
        occupant: terms.orderId,
        generation: '0',
        status: 'refundable_unregistered',
        height: 200n,
        blockHash: snapshot.hash
      }
    })
    for (const e of [deposit, refund])
      await t.db.client.chainEvent.create({
        data: { ...e, scope, height: BigInt(e.height), txIndex: 0n, logIndex: 0n }
      })
    let available = true
    const observer = {
      config,
      deployment,
      async readVerifiedSnapshot() {
        if (!available) throw new Error('RPC fault')
        return snapshot
      },
      async verifyDeployment() {},
      async atHeight(height) {
        return { ...snapshot, height, hash: h(Number(height)) }
      },
      async readOrder() {
        return { ...order }
      },
      async call(name) {
        return name === 'stockOccupant' ? terms.orderId : 0n
      },
      async scanAndVerify() {
        return {
          from: '0',
          snapshot,
          blocks: [],
          events: [deposit, refund],
          orders: [{ ...order }],
          stocks: [{ stockId: terms.stockId, occupant: terms.orderId, generation: '0' }],
          globals
        }
      }
    }
    const exits = new ledgerImplementation.RefundJournal(t.security.client, t.security.id)
    const service = new implementation.RefundRecoveryService(t.db.client, observer, journal, exits)
    return {
      ...t,
      config,
      scope,
      orderId,
      intentId,
      terms,
      record,
      journal,
      exits,
      service,
      observer,
      order,
      snapshot,
      deposit,
      refund,
      available: (value) => {
        available = value
      },
      stock: () =>
        t.db.client.testnetStock.findUniqueOrThrow({ where: { listingId: t.f.listing.id } }),
      exitRows: () => t.security.client.$queryRaw`SELECT * FROM "PaymentLedgerRefundExit"`
    }
  } catch (e) {
    await t.close()
    throw e
  }
}

test('T08-R/A20: verified undelivered refund persists independent proof before restoring exactly one successor generation', async () => {
  const t = await setupRefund()
  try {
    await t.service.runOnce()
    assert.equal((await t.exitRows()).length, 1)
    const stock = await t.stock()
    assert.equal(stock.state, 'free')
    assert.equal(stock.activeOrderId, null)
    assert.equal(stock.generation, '1')
    assert.equal(stock.previousOrderId, t.terms.orderId)
    assert.equal(
      (
        await t.db.client.digitalInventory.findUniqueOrThrow({
          where: { listingId: t.f.listing.id }
        })
      ).availability,
      'available'
    )
    assert.equal(await t.db.client.refundInventoryTransition.count(), 1)
    const row = (await t.exitRows())[0]
    assert.equal(row.neverRegistered, true)
    assert.equal(row.refundTxHash, t.refund.txHash)
    assert.equal(row.finalizedHash, t.snapshot.hash)
    await t.service.runOnce()
    assert.deepEqual(await t.stock(), stock)
    assert.equal((await t.exitRows()).length, 1)
  } finally {
    await t.close()
  }
})
test('T08-R/A20/A27: RPC unavailable, registered delivery or missing event never unlock stock', async () => {
  const t = await setupRefund()
  try {
    t.available(false)
    await assert.rejects(t.service.runOnce())
    assert.equal((await t.stock()).state, 'protected')
    assert.equal((await t.exitRows()).length, 0)
    t.available(true)
    t.order.credentialId = h(99)
    t.order.deliveredAt = '1700000010'
    await assert.rejects(t.service.runOnce())
    assert.equal((await t.stock()).state, 'protected')
    t.order.credentialId = h(0)
    t.order.deliveredAt = '0'
    await t.db.client.chainEvent.deleteMany({ where: { name: 'Refunded' } })
    await assert.rejects(t.service.runOnce())
    assert.equal((await t.stock()).state, 'protected')
  } finally {
    await t.close()
  }
})
test('T08-R/A20/A28: ledger commit then business failure is retried without duplicate exit or early availability', async () => {
  const t = await setupRefund()
  try {
    await assert.rejects(
      t.service.runOnce({
        checkpoint: async (stage) => {
          if (stage === 'before-refund-business-commit') throw new Error('business commit fault')
        }
      }),
      /WALLET_UNAVAILABLE|business commit fault/
    )
    assert.equal((await t.exitRows()).length, 1)
    assert.equal((await t.stock()).state, 'protected')
    assert.equal(await t.db.client.refundInventoryTransition.count(), 0)
    await t.service.runOnce()
    assert.equal((await t.stock()).state, 'free')
    assert.equal(await t.db.client.refundInventoryTransition.count(), 1)
  } finally {
    await t.close()
  }
})
test('T08-R/A20/A28: business rollback retains independent refund proof and can only reapply original stock', async () => {
  const t = await setupRefund()
  try {
    await t.service.runOnce()
    const original = (await t.exitRows())[0]
    await t.db.client.testnetStock.update({
      where: { listingId: t.f.listing.id },
      data: { generation: '0', previousOrderId: h(0), activeOrderId: t.orderId, state: 'protected' }
    })
    await t.db.client.digitalInventory.update({
      where: { listingId: t.f.listing.id },
      data: { availability: 'reserved', activeOrderId: t.orderId }
    })
    await t.db.client.refundInventoryTransition.deleteMany()
    await t.service.runOnce()
    assert.equal((await t.stock()).generation, '1')
    assert.equal((await t.stock()).state, 'free')
    assert.deepEqual((await t.exitRows())[0], original)
    await t.db.client.testnetStock.update({
      where: { listingId: t.f.listing.id },
      data: { generation: '2', state: 'protected' }
    })
    await t.service.runOnce()
    assert.equal((await t.stock()).generation, '2')
    assert.equal((await t.stock()).state, 'protected')
  } finally {
    await t.close()
  }
})

test(
  'T08-R actual T04/T06/T07: undelivered refund, immutable exit, original intent history and legal successor funding',
  { timeout: 120000 },
  async () => {
    const { localEscrow } = await import('./helpers/local-escrow.mjs')
    const { DualChainObserver } = await import('../dist/web3/chain-observer.js'),
      { ChainIndexer } = await import('../dist/web3/chain-indexer.js'),
      { CheckpointPaymentObserver } = await import('../dist/web3/payment-observer.js')
    const { PaymentIntentService } = await import('../dist/web3/payment-intent.service.js'),
      { hashPassword } = await import('../dist/auth/password.js')
    const f = await localEscrow()
    let t, backupRoot, backupFile
    const finalize = async (block) => {
      for (let n = 0; n < 100; n++) {
        if ((await f.publicClient.getBlock({ blockTag: 'finalized' })).number >= block) return
        await f.publicClient.request({ method: 'evm_mine', params: [] })
      }
      throw new Error('local finality stalled')
    }
    try {
      assert.equal(typeof implementation.RefundRecoveryService, 'function')
      const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path')
      backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bazaar-native-refund-'))
      const witnessDirectory = path.join(backupRoot,'witness')
      await fs.mkdir(witnessDirectory,{mode:0o700})
      t = await testnetFixture(f.config,{witnessDirectory})
      t.config.chainDeployment = f.deployment
      await t.bind(f.seller)
      const payout = await t.challenge('payout', f.seller)
      await t.payout.confirmSellerPayout(
        t.user,
        payout.id,
        await f.seller.signTypedData(payout.typedData)
      )
      await t.price('1.000001')
      const password = 'Virtual-T08R-buyer-only'
      await t.db.client.accountCredential.create({
        data: { accountId: t.f.buyer, passwordHash: await hashPassword(password) }
      })
      const a = await t.db.client.account.findUniqueOrThrow({ where: { id: t.f.buyer } }),
        user = await t.auth.login(a.loginName, password, '127.0.0.9'),
        key = randomUUID()
      const reauth = await t.wallets.requestPasswordReauth(
          user,
          password,
          'bind',
          f.buyer.address,
          key,
          '127.0.0.9'
        ),
        challenge = await t.wallets.createActionChallenge(
          user,
          reauth.id,
          'bind',
          f.buyer.address,
          key
        )
      await t.wallets.consumeActionChallenge(
        user,
        challenge.id,
        await f.buyer.signTypedData(challenge.typedData)
      )
      const observer = new DualChainObserver(t.config, f.deployment),
        journal = new PostgresPaymentJournal(t.security.client, t.security.id),
        exits = new ledgerImplementation.RefundJournal(t.security.client, t.security.id)
      const recovery = new implementation.RefundRecoveryService(
        t.db.client,
        observer,
        journal,
        exits
      )
      const indexer = new ChainIndexer(
        t.db.client,
        observer,
        () => journal.assertBusinessBasis(t.db.client, chainScope(t.config)),
        (range) => journal.assertResolutions(range, observer)
      )
      await indexer.projector.initialize('fresh')
      await finalize(BigInt(f.deployment.deploymentBlock))
      await indexer.runOnce()
      let clock = Math.floor(Date.now() / 1000)
      const payments = new PaymentIntentService(
        t.db.client,
        t.auth,
        t.payout,
        t.security.ledger,
        journal,
        f.paymentSigner,
        {
          readIntent: async (p) => {
            const result = await new CheckpointPaymentObserver(t.db.client, observer).readIntent(p)
            return {
              ...result,
              snapshot: { ...result.snapshot, verifiedAt: new Date(clock * 1000) }
            }
          }
        },
        t.config,
        async () => {},
        () => new Date(clock * 1000)
      )
      const old = await payments.createOrder(user, randomUUID(), {
        listingId: t.f.listing.id,
        version: 2
      })
      await f.mintTransfer(f.buyer.address, 3000003n)
      if ((await f.timestamp()) < old.permit.issuedAt) await f.warpMine(old.permit.issuedAt)
      const paid = await f.deposit(old.permit, f.buyer, old.signature)
      await finalize(paid.blockNumber)
      await indexer.runOnce()
      await payments.reconcile(user, old.intentId)
      backupFile = path.join(backupRoot, 'funded.dump')
      await pgTool(t, 'pg_dump', [
        '--format=custom',
        '--schema=' + t.db.schema,
        '--no-owner',
        '--no-privileges',
        '--file=' + backupFile
      ])

      const chainOrder = await observer.readOrder(
        old.permit.orderId,
        await observer.readVerifiedSnapshot()
      )
      await f.warpMine(Number(chainOrder.fundedAt) + 259200)
      const refund = await f.write(f.deployer, f.config.escrow, f.abi.escrow, 'refundUndelivered', [
        old.permit.orderId
      ])
      await finalize(refund.blockNumber)
      await indexer.runOnce()
      await recovery.runOnce()
      const stock = await t.db.client.testnetStock.findUniqueOrThrow({
        where: { listingId: t.f.listing.id }
      })
      assert.equal(stock.state, 'free')
      assert.equal(stock.generation, '1')
      const priorExit = (
        await t.security.client.$queryRaw`SELECT * FROM "PaymentLedgerRefundExit"`
      )[0]
      await pgTool(t, 'pg_restore', [
        '--clean',
        '--if-exists',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--schema=' + t.db.schema,
        '--dbname=' + t.db.url.pathname.slice(1),
        backupFile
      ])
      assert.equal(
        (await t.db.client.order.findUniqueOrThrow({ where: { id: old.orderId } })).status,
        'pending_delivery'
      )
      assert.equal(
        (await t.db.client.testnetStock.findUniqueOrThrow({ where: { listingId: t.f.listing.id } }))
          .state,
        'protected'
      )
      await indexer.runOnce()
      await recovery.runOnce()
      assert.deepEqual(
        (await t.security.client.$queryRaw`SELECT * FROM "PaymentLedgerRefundExit"`)[0],
        priorExit
      )
      assert.equal(
        (await t.db.client.testnetStock.findUniqueOrThrow({ where: { listingId: t.f.listing.id } }))
          .state,
        'free'
      )

      assert.equal((await payments.read(user, old.intentId)).permit.orderId, old.permit.orderId)
      clock = await f.timestamp()
      // The contract keeps original generation0/occupant until actual generation1
      // funding. Unpaid successor expiry, replacement, revoke and close must work.
      const abandoned = await payments.createOrder(user, randomUUID(), {
        listingId: t.f.listing.id,
        version: 2
      })
      await f.warpMine(abandoned.permit.payDeadline)
      await finalize(await f.publicClient.getBlockNumber())
      await indexer.runOnce()
      clock = await f.timestamp()
      assert.equal((await payments.reconcile(user, abandoned.intentId)).status, 'expired')
      const replacement = await payments.replaceIntent(
        user,
        abandoned.orderId,
        randomUUID(),
        abandoned.intentId
      )
      if ((await f.timestamp()) < replacement.permit.issuedAt)
        await f.warpMine(replacement.permit.issuedAt)
      const revoke = await f.write(f.buyer, f.config.escrow, f.abi.escrow, 'revokeIntent', [
        replacement.permit,
        replacement.signature
      ])
      await finalize(revoke.blockNumber)
      await indexer.runOnce()
      clock = await f.timestamp()
      assert.equal((await payments.reconcile(user, replacement.intentId)).status, 'revoked')
      await payments.closeOrder(user, abandoned.orderId, randomUUID())
      assert.equal(
        String(
          await f.read(f.config.escrow, f.abi.escrow, 'stockGeneration', [old.permit.stockId])
        ),
        '0'
      )
      clock = await f.timestamp()
      const next = await payments.createOrder(user, randomUUID(), {
        listingId: t.f.listing.id,
        version: 2
      })
      assert.equal(next.permit.stockId, old.permit.stockId)
      assert.equal(next.permit.stockGeneration, '1')
      assert.equal(next.permit.previousOrderId, old.permit.orderId)
      if ((await f.timestamp()) < next.permit.issuedAt) await f.warpMine(next.permit.issuedAt)
      const funded = await f.deposit(next.permit, f.buyer, next.signature)
      await finalize(funded.blockNumber)
      await indexer.runOnce()
      const before = await t.db.client.testnetStock.findUniqueOrThrow({
        where: { listingId: t.f.listing.id }
      })
      await recovery.runOnce()
      assert.deepEqual(
        await t.db.client.testnetStock.findUniqueOrThrow({ where: { listingId: t.f.listing.id } }),
        before
      )
      assert.equal(before.activeOrderId, next.orderId)
      assert.equal(
        (await observer.readOrder(next.permit.orderId, await observer.readVerifiedSnapshot()))
          .state,
        'Funded'
      )
      await assert.rejects(f.deposit(old.permit, f.buyer, old.signature))
      await t.security.witness.verify()
      if (process.env.T08R_EVIDENCE_FILE)
        await (
          await import('node:fs/promises')
        ).writeFile(
          process.env.T08R_EVIDENCE_FILE,
          JSON.stringify(
            {
              environment:
                'local single Anvil with two proxies; no independent Sepolia RPC validation',
              ledgerWitnessActive: true,
              ledgerWitnessVerifiedAtCompletion: true,
              chainId: f.config.chainId,
              escrow: f.config.escrow,
              token: f.config.token,
              transactions: [paid, refund, revoke, funded].map((r) => ({
                hash: r.transactionHash,
                block: r.blockNumber.toString(),
                blockHash: r.blockHash,
                status: r.status
              })),
              originalOrderId: old.orderId,
              originalChainOrderId: old.permit.orderId,
              nextOrderId: next.orderId,
              nextChainOrderId: next.permit.orderId,
              stockId: old.permit.stockId,
              originalGeneration: '0',
              businessNextGeneration: before.generation,
              chainFinalGeneration: String(
                await f.read(f.config.escrow, f.abi.escrow, 'stockGeneration', [old.permit.stockId])
              ),
              refundExitHash: priorExit.basisHash,
              refundEvent: {
                hash: priorExit.refundTxHash,
                logIndex: String(priorExit.refundLogIndex),
                blockHash: priorExit.refundBlockHash
              },
              commonFinalizedBlock: priorExit.finalizedHash,
              neverRegistered: priorExit.neverRegistered,
              fundedBackupRestoredAndRescanned: true,
              unfundedSuccessorExpiredReplacedRevokedAndClosed: true,
              oldPermitReplayRejected: true
            },
            null,
            2
          ) + '\n'
        )

      assert.equal(
        (
          await t.security.client
            .$queryRaw`SELECT count(*)::int AS n FROM "PaymentLedgerRefundExit"`
        )[0].n,
        1
      )
    } finally {
      if (t) await t.close()
      await f.close()
      if (backupRoot)
        await (await import('node:fs/promises')).rm(backupRoot, { recursive: true, force: true })
    }
  }
)

async function recoveryChild(t, phase, real = false) {
  const { fork } = await import('node:child_process'),
    { once } = await import('node:events')
  const child = fork(new URL('./helpers/refund-recovery-process.mjs', import.meta.url), [], {
    env: {
      PATH: process.env.PATH,
      TEST_DATABASE_URL: t.db.url.toString(),
      TEST_LEDGER_URL: t.security.url.toString()
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  const exited = once(child, 'exit'),
    timer = setTimeout(() => child.kill('SIGKILL'), 20000)
  try {
    child.send({
      phase,
      real,
      config: t.config,
      deployment: t.config.chainDeployment,
      fixture: {
        snapshot: t.snapshot,
        order: t.order,
        events: [t.deposit, t.refund],
        globals: {},
        blocks: { [t.snapshot.height]: t.snapshot.hash }
      }
    })
    const [message] = await Promise.race([
      once(child, 'message'),
      exited.then(() => {
        throw new Error('recovery child exited before evidence')
      })
    ])
    assert.notEqual(message.stage, 'error', message.code)
    if (phase !== 'once') {
      assert.equal(message.stage, phase)
      child.kill('SIGKILL')
      const [, signal] = await exited
      assert.equal(signal, 'SIGKILL')
    } else {
      assert.equal(message.stage, 'done')
      await exited
    }
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await exited
    }
  }
}
for (const phase of [
  'before-refund-ledger-write',
  'before-refund-ledger-commit',
  'after-refund-ledger-commit',
  'before-refund-business-commit',
  'after-refund-business-commit'
])
  test('T08-R actual SIGKILL: ' + phase, { timeout: 40000 }, async () => {
    const t = await setupRefund()
    try {
      await recoveryChild(t, phase)
      let rows
      for (let n = 0; n < 30; n++) {
        try {
          rows = await t.exitRows()
          break
        } catch {
          await new Promise((r) => setTimeout(r, 20))
        }
      }
      assert.equal(
        rows.length,
        ['before-refund-ledger-write', 'before-refund-ledger-commit'].includes(phase) ? 0 : 1
      )
      assert.equal(
        (await t.stock()).state,
        phase === 'after-refund-business-commit' ? 'free' : 'protected'
      )
      await recoveryChild(t, 'once')
      assert.equal((await t.stock()).state, 'free')
      assert.equal((await t.exitRows()).length, 1)
      assert.equal(await t.db.client.refundInventoryTransition.count(), 1)
    } finally {
      await t.close()
    }
  })

test('T08-R/A28: actual business connection termination rolls back stock but retains independent exit', async () => {
  const t = await setupRefund()
  try {
    await assert.rejects(
      t.service.runOnce({
        checkpoint: async (stage, tx) => {
          if (stage === 'before-refund-business-commit') {
            const [row] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`
            await t.db.client.$queryRaw`SELECT pg_terminate_backend(${row.pid})`
          }
        }
      })
    )
    assert.equal((await t.exitRows()).length, 1)
    assert.equal((await t.stock()).state, 'protected')
    await t.service.runOnce()
    assert.equal((await t.stock()).state, 'free')
  } finally {
    await t.close()
  }
})

test('T08-R/A27: missing independent exit cannot justify restored free successor stock', async () => {
  const t = await setupRefund()
  try {
    await t.service.runOnce()
    await t.security.client.$executeRaw`DELETE FROM "PaymentLedgerRefundExit"`
    await assert.rejects(t.journal.assertBusinessBasis(t.db.client, t.scope), /WALLET_UNAVAILABLE/)
  } finally {
    await t.close()
  }
})

async function prepareSuccessor(t) {
  const orderId = await t.create(),
    intentId = randomUUID(),
    permit = {
      ...t.record.permit,
      orderId: id('order', orderId),
      intentId: id('intent', intentId),
      stockGeneration: '1',
      previousOrderId: t.terms.orderId,
      issuedAt: t.record.permit.issuedAt + 300000,
      payDeadline: t.record.permit.issuedAt + 301800
    }
  const terms = { ...permit }
  for (const key of ['schemaVersion', 'intentId', 'issuedAt', 'payDeadline', 'signerKeyId'])
    delete terms[key]
  const record = {
    ...t.record,
    id: intentId,
    orderId,
    permit,
    termsHash: orderTermsDigest(terms),
    digest: paymentDigest(permit),
    previousIntentId: t.intentId
  }
  await t.db.client.$transaction(async (tx) => {
    await tx.paymentOrderTerms.create({
      data: {
        orderId,
        listingId: t.f.listing.id,
        stockId: t.terms.stockId,
        terms,
        termsHash: record.termsHash,
        recoveryEpoch: t.security.epoch,
        initialIntentId: intentId
      }
    })
    await tx.paymentIntent.create({
      data: { id: intentId, orderId, permit, digest: record.digest, previousIntentId: t.intentId }
    })
    await tx.paymentIntentState.create({ data: { intentId, orderId, status: 'issued' } })
    await tx.testnetStock.update({
      where: { listingId: t.f.listing.id },
      data: { state: 'reserved', activeOrderId: orderId, lastOrderId: orderId }
    })
  })
  await t.journal.authorize(record)
  return record
}
test('T08-R/A20/A28: replay cannot release a successor reservation or a restored original slot after independent head advances', async () => {
  const t = await setupRefund()
  try {
    await t.service.runOnce()
    const exit = (await t.exitRows())[0],
      next = await prepareSuccessor(t),
      before = await t.stock()
    assert.equal((await t.service.apply(exit)).status, 'superseded')
    assert.deepEqual(await t.stock(), before)
    await t.db.client.testnetStock.update({
      where: { listingId: t.f.listing.id },
      data: {
        generation: '0',
        previousOrderId: h(0),
        state: 'protected',
        activeOrderId: t.orderId,
        lastOrderId: t.orderId
      }
    })
    await assert.rejects(t.journal.assertBusinessBasis(t.db.client, t.scope), /WALLET_UNAVAILABLE/)
    assert.equal((await t.service.apply(exit)).status, 'superseded')
    assert.equal((await t.stock()).state, 'protected')
    assert.equal(
      (
        await t.db.client.digitalInventory.findUniqueOrThrow({
          where: { listingId: t.f.listing.id }
        })
      ).activeOrderId,
      next.orderId
    )
  } finally {
    await t.close()
  }
})

async function pgTool(t, program, args) {
  const { spawn } = await import('node:child_process'),
    u = t.db.url
  const child = spawn(program, args, {
    env: {
      PATH: process.env.PATH,
      PGHOST: u.hostname,
      PGPORT: u.port,
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: u.pathname.slice(1)
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (b) => {
    if (stderr.length < 8000) stderr += b.toString()
  })
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', resolve)
  })
  assert.equal(code, 0, stderr)
}
test(
  'T08-R/A28 actual pg_dump/pg_restore: older business backup cannot erase independent exit or release missing successor history',
  { timeout: 60000 },
  async () => {
    const t = await setupRefund(),
      { mkdtemp, rm } = await import('node:fs/promises'),
      { tmpdir } = await import('node:os'),
      { join } = await import('node:path')
    const root = await mkdtemp(join(tmpdir(), 'bazaar-refund-restore-')),
      backup = join(root, 'business.dump')
    try {
      await pgTool(t, 'pg_dump', [
        '--format=custom',
        '--schema=' + t.db.schema,
        '--no-owner',
        '--no-privileges',
        '--file=' + backup
      ])
      await t.service.runOnce()
      const exit = (await t.exitRows())[0]
      await pgTool(t, 'pg_restore', [
        '--clean',
        '--if-exists',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--schema=' + t.db.schema,
        '--dbname=' + t.db.url.pathname.slice(1),
        backup
      ])
      assert.equal((await t.stock()).state, 'protected')
      assert.equal(await t.db.client.refundInventoryTransition.count(), 0)
      assert.deepEqual((await t.exitRows())[0], exit)
      await recoveryChild(t, 'once')
      assert.equal((await t.stock()).state, 'free')
      await prepareSuccessor(t)
      await pgTool(t, 'pg_restore', [
        '--clean',
        '--if-exists',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--schema=' + t.db.schema,
        '--dbname=' + t.db.url.pathname.slice(1),
        backup
      ])
      await assert.rejects(t.service.runOnce(), /WALLET_UNAVAILABLE/)
      assert.equal((await t.stock()).state, 'protected')
      assert.equal((await t.exitRows()).length, 1)
    } finally {
      await t.close()
      await rm(root, { recursive: true, force: true })
    }
  }
)

test('T08-R/A27: corrupt refund certificate is not silently ignored after business stock rolls back', async () => {
  const t = await setupRefund()
  try {
    await t.service.runOnce()
    await t.db.client.testnetStock.update({
      where: { listingId: t.f.listing.id },
      data: {
        generation: '0',
        previousOrderId: h(0),
        activeOrderId: t.orderId,
        lastOrderId: t.orderId,
        state: 'protected'
      }
    })
    await t.security.client
      .$executeRaw`UPDATE "PaymentLedgerRefundExit" SET "basisHash"=${'0'.repeat(64)}`
    await assert.rejects(t.journal.assertBusinessBasis(t.db.client, t.scope), /WALLET_UNAVAILABLE/)
    await assert.rejects(t.service.runOnce(), /WALLET_UNAVAILABLE/)
    assert.equal((await t.stock()).state, 'protected')
  } finally {
    await t.close()
  }
})
test('T08-R/A27: missing refund ledger schema blocks preflight even before any refund row exists', async () => {
  const t = await setupRefund()
  try {
    await t.security.client.$executeRawUnsafe(
      'ALTER TABLE "PaymentLedgerRefundExit" RENAME TO "MissingRefundLedger"'
    )
    await assert.rejects(t.journal.assertBusinessBasis(t.db.client, t.scope), /WALLET_UNAVAILABLE/)
    assert.equal((await t.stock()).state, 'protected')
  } finally {
    await t.close()
  }
})

test('T10/A20/A27: native refund-ledger rollback isolates even previously free inventory; matching ledger is necessary but not recovery approval',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
  const root=await mkdtemp(join(tmpdir(),'bazaar-refund-witness-'))
  let t
  try{
    t=await setupRefund({witnessDirectory:root})
    const schema=t.security.url.searchParams.get('schema'),old=join(root,'before-refund.dump'),latest=join(root,'after-refund.dump')
    const dump=path=>pgTool(t,'pg_dump',['--format=custom','--no-owner','--no-privileges','--schema='+schema,'--file='+path])
    const restore=path=>pgTool(t,'pg_restore',['--clean','--if-exists','--exit-on-error','--no-owner','--no-privileges','--schema='+schema,'--dbname='+t.db.url.pathname.slice(1),path])
    await dump(old)
    assert.equal((await t.service.runOnce()).applied,1)
    assert.equal((await t.stock()).state,'free')
    await dump(latest)
    const faultAt=new Date().toISOString()
    await restore(old)
    await assert.rejects(t.exits.find(t.scope,t.terms.orderId),/WALLET_UNAVAILABLE/)
    await assert.rejects(t.security.ledger.recoveryEpoch(),/WALLET_UNAVAILABLE/)
    const {ChainIndexer}=await import('../dist/web3/chain-indexer.js')
    const worker=new ChainIndexer(t.db.client,t.observer,()=>t.journal.assertBusinessBasis(t.db.client,t.scope))
    await assert.rejects(worker.runOnce(),/independent issuance or private recovery basis unavailable/)
    assert.equal((await t.stock()).state,'protected')
    await assert.rejects(t.service.runOnce(),/WALLET_UNAVAILABLE/)
    assert.equal((await t.stock()).state,'protected')
    const held=await t.db.client.scanCheckpoint.findUniqueOrThrow({where:{scope:t.scope}})
    assert.notEqual(held.status,'active')
    await restore(latest)
    await t.security.witness.verify()
    assert.equal((await t.exits.find(t.scope,t.terms.orderId)).neverRegistered,true)
    // Do not reopen business state just because the independent ledger matches.
    assert.notEqual((await t.db.client.scanCheckpoint.findUniqueOrThrow({where:{scope:t.scope}})).status,'active')
    if(process.env.T10_RECOVERY_EVIDENCE_FILE){
      const {writeFile}=await import('node:fs/promises')
      const {evaluateRecovery}=await import('../dist/web3/recovery-report.js')
      const evidence={faultAt,observedAt:new Date().toISOString(),consistentPointAt:null,openedAt:null,
        infrastructureAvailable:true,independentRpcAvailable:false,checks:{ledgerWitness:true},
        missing:['consistent business/object backup','deletion ledger','full identity and file authorization restore','independent RPC recheck']}
      await writeFile(process.env.T10_RECOVERY_EVIDENCE_FILE,JSON.stringify({
        schemaVersion:1,scope:'ledger-only safety drill; not full disaster recovery',
        businessOrderId:t.orderId,chainOrderId:t.terms.orderId,
        observationSource:'in-process chain observation substitute; real PostgreSQL pg_dump/pg_restore',
        rollbackRejected:true,workerProtectedInventory:true,matchingLatestLedgerVerified:true,
        checkpointReopened:false,finalStockState:(await t.stock()).state,
        evidence,evaluation:evaluateRecovery(evidence)
      },null,2)+'\n')
    }
  }finally{if(t)await t.close();await rm(root,{recursive:true,force:true})}
})
