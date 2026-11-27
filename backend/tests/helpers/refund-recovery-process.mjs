// Dedicated isolated DB crash worker. Never reads .env or user signing keys.
import { DatabaseService } from '../../dist/database/database.service.js'
import { DualChainObserver } from '../../dist/web3/chain-observer.js'
import { PostgresPaymentJournal } from '../../dist/web3/payment-journal.js'
import { RefundJournal } from '../../dist/web3/refund-journal.js'
import { RefundRecoveryService } from '../../dist/web3/refund-recovery.service.js'
process.once('message', async (m) => {
  const db = new DatabaseService(process.env.TEST_DATABASE_URL),
    security = new DatabaseService(process.env.TEST_LEDGER_URL)
  try {
    await db.onModuleInit()
    await security.onModuleInit()
    const x = m.fixture
    const observer = m.real
      ? new DualChainObserver(m.config, m.deployment)
      : {
          config: m.config,
          deployment: m.deployment,
          readVerifiedSnapshot: async () => x.snapshot,
          verifyDeployment: async () => {},
          atHeight: async (height) => ({
            ...x.snapshot,
            height,
            hash: height === x.snapshot.height ? x.snapshot.hash : x.blocks[height]
          }),
          readOrder: async () => x.order,
          call: async (name) =>
            name === 'stockOccupant' ? x.order.orderId : BigInt(x.order.generation),
          scanAndVerify: async () => ({
            ...x,
            from: '0',
            blocks: [],
            orders: [x.order],
            stocks: [
              {
                stockId: x.order.stockId,
                occupant: x.order.orderId,
                generation: x.order.generation
              }
            ]
          })
        }
    const recovery = new RefundRecoveryService(
      db.client,
      observer,
      new PostgresPaymentJournal(security.client, m.config.securityLedgerId),
      new RefundJournal(security.client, m.config.securityLedgerId)
    )
    const result = await recovery.runOnce({
      checkpoint: async (stage) => {
        if (stage === m.phase) {
          process.send({ stage })
          await new Promise(() => {})
        }
      }
    })
    process.send({ stage: 'done', result })
  } catch (e) {
    process.send({ stage: 'error', code: e.code ?? e.name })
  } finally {
    await db.onModuleDestroy()
    await security.onModuleDestroy()
    process.disconnect()
  }
})
