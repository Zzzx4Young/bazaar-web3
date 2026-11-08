import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { encodeFunctionData } from 'viem'
import { sandbox } from './helpers/database.mjs'
import { localEscrow } from './helpers/local-escrow.mjs'
import { escrowAbi } from '../dist/web3/escrow-abi.js'
import { DualChainObserver } from '../dist/web3/chain-observer.js'
import { ChainIndexer } from '../dist/web3/chain-indexer.js'

async function worker(db, f, phase) {
  const child = fork(
    fileURLToPath(new URL('./helpers/chain-indexer-process.mjs', import.meta.url)),
    [],
    {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, TEST_DATABASE_URL: db.url.toString() },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    }
  )
  const exit = once(child, 'exit'),
    timer = setTimeout(() => child.kill('SIGKILL'), 20000)
  try {
    const message = Promise.race([
      once(child, 'message'),
      exit.then(() => {
        throw new Error('Dedicated indexer exited before checkpoint acknowledgment')
      })
    ])
    child.send({ config: f.config, deployment: f.deployment, phase })
    const [reply] = await message
    assert.notEqual(reply.stage, 'error', reply.message)
    assert.equal(reply.stage, phase === 'before-commit' ? 'before-commit' : 'after-commit')
    if (phase === 'before-commit' || phase === 'after-commit') child.kill('SIGKILL')
    const [, signal] = await exit
    if (phase !== 'once') assert.equal(signal, 'SIGKILL')
    return reply
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await exit
    }
  }
}
async function facts(db) {
  const cursor = await db.client.scanCheckpoint.findFirstOrThrow()
  return {
    height: cursor.height.toString(),
    hash: cursor.hash,
    status: cursor.status,
    globals: cursor.globals,
    manifests: await db.client.chainSnapshot.findMany({
      select: { height: true, hash: true, ordersHash: true, stocksHash: true, globals: true },
      orderBy: { height: 'asc' }
    }),
    events: await db.client.chainEvent.findMany({
      orderBy: [{ height: 'asc' }, { txIndex: 'asc' }, { logIndex: 'asc' }]
    }),
    orders: await db.client.escrowProjection.findMany({ orderBy: { chainOrderId: 'asc' } }),
    stocks: await db.client.chainStockProjection.findMany({ orderBy: { stockId: 'asc' } })
  }
}
async function finalized(f, lastBlock) {
  // Real local Anvil finalized tag, not a mock provider's rewritten latest tag.
  for (let i = 0; i < 100; i++) {
    const b = await f.publicClient.getBlock({ blockTag: 'finalized' })
    if (b.number >= lastBlock) return b
    await f.publicClient.request({ method: 'evm_mine', params: [] })
  }
  throw new Error('Local Anvil did not finalize fixture within budget')
}
test(
  'T07 actual T06 EVM events: whole-range projection, repeat scan, rebuild and pre/post-commit SIGKILL',
  { timeout: 120000 },
  async () => {
    const f = await localEscrow()
    let db, rebuilt
    try {
      assert.deepEqual(escrowAbi, f.abi.escrow)
      db = await sandbox()
      rebuilt = await sandbox()
      const principal = 1000001n
      await f.mintTransfer(f.buyer.address, principal)
      const buyerBefore = await f.balance(f.buyer.address),
        sellerBefore = await f.balance(f.seller.address)
      const p = await f.paymentPermit()
      const funded = await f.deposit(p)
      const escrowDuring = await f.balance(f.config.escrow)
      const delivery = await f.deliveryPermit(p.orderId)
      const delivered = await f.deliver(delivery)
      const disputed = await f.dispute(p.orderId)
      const refunded = await f.safeExecute(
        f.deployment.arbitrator,
        f.owners.arbitrator,
        f.config.escrow,
        encodeFunctionData({
          abi: f.abi.escrow,
          functionName: 'resolveDispute',
          args: [p.orderId, true, '0x' + '1'.repeat(64)]
        })
      )
      const h = await finalized(f, refunded.blockNumber)
      const observer = new DualChainObserver(f.config, f.deployment),
        indexer = new ChainIndexer(db.client, observer)
      await indexer.projector.initialize('recovery')
      // A real child is killed while its transaction holds all writes and cursor.
      await worker(db, f, 'before-commit')
      for (let i = 0; i < 20 && (await db.client.chainEvent.count()); i++) await delay(25)
      assert.equal(await db.client.chainEvent.count(), 0)
      assert.equal(await db.client.escrowProjection.count(), 0)
      assert.equal(await db.client.chainSnapshot.count(), 0)
      assert.equal(
        (await db.client.scanCheckpoint.findFirstOrThrow()).height,
        BigInt(f.deployment.deploymentBlock) - 1n
      )
      // A new child replays, commits and is killed after the commit acknowledgment.
      await worker(db, f, 'after-commit')
      const committed = await facts(db)
      assert.equal(committed.orders[0].state, 'Refunded')
      assert.equal(committed.orders[0].downloadEnabled, false)
      assert.equal(committed.orders[0].holdReason, 'PRIVATE_BASIS_MISSING')
      assert.equal(committed.stocks[0].status, 'blocked_registered')
      assert.equal(committed.globals.outstanding, '0')
      assert.equal(committed.globals.totalDeposited, '1000001')
      assert.equal(committed.globals.totalPaid, '1000001')
      // Restart uses the real committed cursor, does not duplicate any application.
      await worker(db, f, 'once')
      assert.deepEqual(await facts(db), committed)
      const reference = new ChainIndexer(
        rebuilt.client,
        new DualChainObserver(f.config, f.deployment)
      )
      await reference.projector.initialize('recovery')
      await reference.runOnce()
      assert.deepEqual(await facts(rebuilt), committed)
      assert.equal(await db.client.privateFileVersion.count(), 0)
      if (process.env.T07_EVIDENCE_FILE)
        await writeFile(
          process.env.T07_EVIDENCE_FILE,
          JSON.stringify(
            {
              environment:
                'D/L: one local Anvil behind two loopback proxies, not independent providers or Sepolia finality',
              deployment: f.deployment,
              config: f.config,
              transactions: [funded, delivered, disputed, refunded].map((r) => ({
                transactionHash: r.transactionHash,
                blockHash: r.blockHash,
                blockNumber: r.blockNumber.toString(),
                status: r.status
              })),
              localFinalized: { height: h.number.toString(), hash: h.hash },
              facts: committed,
              processDrills: [
                'SIGKILL before commit: rolled back',
                'SIGKILL after commit: retained',
                'new process: exactly same projection',
                'fresh schema: exactly same chain projection'
              ],
              balances: {
                buyerBefore: buyerBefore.toString(),
                sellerBefore: sellerBefore.toString(),
                escrowDuring: escrowDuring.toString(),
                buyerAfter: (await f.balance(f.buyer.address)).toString(),
                sellerAfter: (await f.balance(f.seller.address)).toString(),
                escrowAfter: (await f.balance(f.config.escrow)).toString()
              },
              privateMappingsRebuilt: false,
              downloadsEnabled: false
            },
            (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
            2
          ) + '\n',
          { mode: 0o600 }
        )
    } finally {
      if (rebuilt) await rebuilt.close()
      if (db) await db.close()
      await f.close()
    }
  }
)
test(
  'T07 actual T04 order and credential reach T06 events and atomically project refund to the existing Account.id order',
  { timeout: 120000 },
  async () => {
    const { testnetFixture } = await import('./helpers/testnet.mjs')
    const { WalletAuthService } = await import('../dist/auth/wallet-auth.service.js')
    const { SellerPayoutService } = await import('../dist/web3/seller-payout.service.js')
    const { PaymentIntentService } = await import('../dist/web3/payment-intent.service.js')
    const { PostgresPaymentJournal } = await import('../dist/web3/payment-journal.js')
    const { CheckpointPaymentObserver } = await import('../dist/web3/payment-observer.js')
    const { hashPassword } = await import('../dist/auth/password.js')
    const { randomUUID } = await import('node:crypto')
    const f = await localEscrow()
    let t
    try {
      t = await testnetFixture()
      Object.assign(t.config, f.config, { chainDeployment: f.deployment })
      const observer = new DualChainObserver(t.config, f.deployment),
        journal = new PostgresPaymentJournal(t.security.client, t.security.id),
        indexer = new ChainIndexer(
          t.db.client,
          observer,
          () => journal.assertBusinessBasis(t.db.client, t.config.chainId + ':' + t.config.escrow),
          (range) => journal.assertResolutions(range, observer)
        )
      await finalized(f, BigInt(f.deployment.deploymentBlock))
      await indexer.projector.initialize('fresh')
      await indexer.runOnce()
      const wallets = new WalletAuthService(t.db.client, t.auth, t.security.ledger, {
        ...t.config,
        appOrigin: 'http://localhost:3000',
        assertEoa: async () => {}
      })
      const payout = new SellerPayoutService(t.db.client, wallets, t.security.ledger, t.config)
      const action = async (user, password, purpose, w) => {
        const key = randomUUID(),
          proof = await wallets.requestPasswordReauth(
            user,
            password,
            purpose,
            w.address,
            key,
            '127.0.0.1'
          ),
          challenge = await wallets.createActionChallenge(user, proof.id, purpose, w.address, key),
          signature = await w.signTypedData(challenge.typedData)
        return purpose === 'payout'
          ? payout.confirmSellerPayout(user, challenge.id, signature)
          : wallets.consumeActionChallenge(user, challenge.id, signature)
      }
      await action(t.user, 'Virtual-T03-seller-password-only', 'bind', f.seller)
      await action(t.user, 'Virtual-T03-seller-password-only', 'payout', f.seller)
      await t.price('1.000001')
      await t.db.client.accountCredential.create({
        data: { accountId: t.f.buyer, passwordHash: await hashPassword('Virtual-T07-linked-buyer') }
      })
      const buyer = await t.db.client.account.findUniqueOrThrow({ where: { id: t.f.buyer } }),
        user = await t.auth.login(buyer.loginName, 'Virtual-T07-linked-buyer', '127.0.0.2')
      await action(user, 'Virtual-T07-linked-buyer', 'bind', f.buyer)
      const payments = new PaymentIntentService(
        t.db.client,
        t.auth,
        payout,
        t.security.ledger,
        new PostgresPaymentJournal(t.security.client, t.security.id),
        f.paymentSigner,
        new CheckpointPaymentObserver(t.db.client, observer),
        t.config,
        async () => {}
      )
      // A legitimate accepted invalidity must remain usable as history, not block
      // all later orders. This exercises both the no-new-H and next-range guards.
      const cancelled = await payments.createOrder(user, randomUUID(), {
        listingId: t.f.listing.id,
        version: 2
      })
      await payments.requestIntentCancel(user, cancelled.intentId, randomUUID())
      // The preflight runs against latest; mine the next local block so a newly
      // issued server credential is not simulated against a block two seconds old.
      await f.warpMine(Math.max(cancelled.permit.issuedAt, (await f.timestamp()) + 1))
      const beforeRevoke = await f.timestamp()
      assert.ok(
        beforeRevoke >= cancelled.permit.issuedAt && beforeRevoke < cancelled.permit.payDeadline,
        JSON.stringify({
          test: 'local preflight block time',
          beforeRevoke,
          issuedAt: cancelled.permit.issuedAt,
          payDeadline: cancelled.permit.payDeadline
        })
      )
      const revoke = await f.write(f.buyer, f.config.escrow, f.abi.escrow, 'revokeIntent', [
        cancelled.permit,
        cancelled.signature
      ])
      await finalized(f, revoke.blockNumber)
      await indexer.runOnce()
      await payments.reconcile(user, cancelled.intentId)
      await payments.closeOrder(user, cancelled.orderId, randomUUID())
      await indexer.runOnce()
      assert.equal(
        (await t.db.client.order.findUniqueOrThrow({ where: { id: cancelled.orderId } })).status,
        'cancelled'
      )
      const a = await payments.createOrder(user, randomUUID(), {
        listingId: t.f.listing.id,
        version: 2
      })
      assert.equal(a.permit.buyer, f.buyer.address.toLowerCase())
      assert.equal(a.permit.amountAtoms, '1000001')
      await f.mintTransfer(f.buyer.address, 1000001n)
      if ((await f.timestamp()) < a.permit.issuedAt) await f.warpMine(a.permit.issuedAt)
      assert.ok(
        (await f.timestamp()) < a.permit.payDeadline,
        'local preflight must preserve the original payment deadline'
      )
      await f.deposit(a.permit, f.buyer, a.signature)
      const d = await f.deliveryPermit(a.permit.orderId)
      await f.deliver(d)
      await f.dispute(a.permit.orderId)
      const refund = await f.safeExecute(
        f.deployment.arbitrator,
        f.owners.arbitrator,
        f.config.escrow,
        encodeFunctionData({
          abi: f.abi.escrow,
          functionName: 'resolveDispute',
          args: [a.permit.orderId, true, '0x' + '2'.repeat(64)]
        })
      )
      await finalized(f, refund.blockNumber)
      await indexer.runOnce({
        checkpoint: async (stage) => {
          if (stage === 'before-commit')
            assert.equal(
              (await t.db.read((c) => c.order.findUniqueOrThrow({ where: { id: a.orderId } })))
                .status,
              'pending_payment'
            )
        }
      })
      const order = await t.db.client.order.findUniqueOrThrow({ where: { id: a.orderId } })
      assert.equal(order.status, 'refunded')
      assert.equal(order.buyerId, t.f.buyer)
      assert.equal(order.sellerId, t.f.seller)
      assert.equal(order.version, 2)
      const projected = await t.db.client.escrowProjection.findFirstOrThrow()
      assert.equal(projected.businessOrderId, a.orderId)
      assert.equal(projected.state, 'Refunded')
      assert.equal(projected.downloadEnabled, false)
      assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).activeOrderId, a.orderId)
      assert.equal((await t.db.client.testnetStock.findFirstOrThrow()).state, 'protected')
      assert.equal(
        (
          await t.db.client.paymentIntentState.findUniqueOrThrow({
            where: { intentId: a.intentId }
          })
        ).status,
        'funded'
      )
      assert.equal(await t.db.client.privateFileVersion.count(), 0)
      await indexer.runOnce()
      assert.equal(
        (await t.db.client.order.findUniqueOrThrow({ where: { id: a.orderId } })).version,
        2
      )
      const { EscrowReconciliation } = await import('../dist/web3/reconciliation.js')
      const report = await new EscrowReconciliation(t.db.client, indexer).reconcileOrder(a.orderId)
      assert.equal(report.state, 'Refunded')
      assert.equal(report.downloadEnabled, false)
      assert.equal(report.inventoryProtection, 'held')
      const observed = await new CheckpointPaymentObserver(t.db.client, observer).readIntent(
        a.permit
      )
      assert.equal(observed.orderState, 'Refunded')
      assert.equal(observed.signerRevoked, false)
      if (process.env.T07_BUSINESS_EVIDENCE_FILE)
        await writeFile(
          process.env.T07_BUSINESS_EVIDENCE_FILE,
          JSON.stringify(
            {
              environment: 'D/L: actual T04 service + dedicated Anvil T06 + T07; not Sepolia',
              businessOrder: {
                id: order.id,
                buyerId: order.buyerId,
                sellerId: order.sellerId,
                status: order.status,
                version: order.version
              },
              chain: {
                chainId: t.config.chainId,
                escrow: t.config.escrow,
                token: t.config.token,
                chainOrderId: a.permit.orderId,
                intentId: a.permit.intentId,
                stockId: a.permit.stockId,
                amountAtoms: a.permit.amountAtoms,
                refundTx: refund.transactionHash
              },
              projection: projected,
              stock: await t.db.client.testnetStock.findFirstOrThrow(),
              verifiedOrderState: observed.orderState,
              legitimateCancellationOrderId: cancelled.orderId,
              cancellationState: (
                await t.db.client.paymentIntentState.findUniqueOrThrow({
                  where: { intentId: cancelled.intentId }
                })
              ).status,
              fileVersions: 0,
              downloadEnabled: false
            },
            (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
            2
          ) + '\n',
          { mode: 0o600 }
        )

      assert.equal(
        observed.orderTermsHash,
        (await t.db.client.paymentOrderTerms.findUniqueOrThrow({ where: { orderId: a.orderId } }))
          .termsHash
      )
    } finally {
      if (t) await t.close()
      await f.close()
    }
  }
)
test(
  'T07 real EVM data with one-source faults never commits partial finalized results',
  { timeout: 120000 },
  async () => {
    const { chainRpc } = await import('../dist/web3/chain-observer.js')
    const f = await localEscrow()
    try {
      await f.mintTransfer(f.buyer.address, 1000001n)
      const p = await f.paymentPermit()
      const funded = await f.deposit(p)
      await finalized(f, funded.blockNumber)
      for (const fault of ['offline', 'receipt', 'logs', 'state']) {
        const db = await sandbox()
        try {
          const rpc = async (source, method, params) => {
            if (source === f.config.rpcSecondary && fault === 'offline')
              throw new Error('synthetic source unavailable')
            const value = await chainRpc(source, method, params)
            if (source === f.config.rpcSecondary) {
              if (fault === 'receipt' && method === 'eth_getTransactionReceipt')
                return { ...value, status: '0x0' }
              if (fault === 'logs' && method === 'eth_getLogs')
                return value.filter((l) => l.transactionHash !== funded.transactionHash)
              if (fault === 'state' && method === 'eth_call') return '0x'
            }
            return value
          }
          const i = new ChainIndexer(db.client, new DualChainObserver(f.config, f.deployment, rpc))
          await i.projector.initialize('recovery')
          await assert.rejects(
            i.runOnce(),
            (e) => e.kind === (fault === 'offline' ? 'unavailable' : 'contradiction')
          )
          assert.equal(await db.client.chainEvent.count(), 0)
          assert.equal(await db.client.escrowProjection.count(), 0)
          const cursor = await db.client.scanCheckpoint.findFirstOrThrow()
          assert.equal(cursor.height, BigInt(f.deployment.deploymentBlock) - 1n)
          assert.equal(cursor.status, fault === 'offline' ? 'recovering' : 'isolated')
        } finally {
          await db.close()
        }
      }
    } finally {
      await f.close()
    }
  }
)
test(
  'T07 actual unfinalized local reorg orphans only tentative observation and never pays an order',
  { timeout: 120000 },
  async () => {
    const f = await localEscrow()
    let db
    try {
      db = await sandbox()
      const o = new DualChainObserver(f.config, f.deployment)
      await f.mintTransfer(f.buyer.address, 1000001n)
      const snapshot = await f.publicClient.request({ method: 'evm_snapshot', params: [] })
      const p = await f.paymentPermit(),
        funded = await f.deposit(p)
      const seen = await o.observeTransaction(funded.transactionHash)
      assert.equal(seen.status, 'included')
      assert.equal(seen.businessConfirmation, false)
      assert.equal(await f.publicClient.request({ method: 'evm_revert', params: [snapshot] }), true)
      await f.publicClient.request({ method: 'evm_mine', params: [] })
      const reverted = await o.observeTransaction(funded.transactionHash, seen)
      assert.equal(reverted.status, 'unknown')
      assert.equal(reverted.orphanedBlockHash, funded.blockHash)
      assert.equal(await db.client.escrowProjection.count(), 0)
      assert.equal(await db.client.chainEvent.count(), 0)
    } finally {
      if (db) await db.close()
      await f.close()
    }
  }
)
