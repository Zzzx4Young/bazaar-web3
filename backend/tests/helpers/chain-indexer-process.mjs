// Dedicated child used by the OS-crash drill; never reads .env or real wallets.
import { DatabaseService } from '../../dist/database/database.service.js'
import { DualChainObserver } from '../../dist/web3/chain-observer.js'
import { ChainIndexer } from '../../dist/web3/chain-indexer.js'
process.once('message', async (message) => {
  const db = new DatabaseService(process.env.TEST_DATABASE_URL)
  try {
    await db.onModuleInit()
    const indexer = new ChainIndexer(
      db.client,
      new DualChainObserver(message.config, message.deployment)
    )
    const result = await indexer.runOnce({
      checkpoint: async (stage) => {
        if (message.phase === 'before-commit' && stage === 'before-commit') {
          process.send({ stage: 'before-commit' })
          await new Promise(() => {})
        }
      }
    })
    process.send({ stage: 'after-commit', result })
    if (message.phase === 'after-commit') await new Promise(() => {})
    await db.onModuleDestroy()
    process.disconnect()
  } catch (error) {
    await db.onModuleDestroy()
    process.send({ stage: 'error', message: error instanceof Error ? error.message : 'unknown' })
    process.exitCode = 1
    process.disconnect()
  }
})
