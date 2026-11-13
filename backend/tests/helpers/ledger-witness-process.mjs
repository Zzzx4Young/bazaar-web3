// Isolated crash-test child only; never reads .env or user keys.
import { DatabaseService } from '../../dist/database/database.service.js'
import { LedgerWitness, registerLedgerWitness } from '../../dist/auth/ledger-witness.js'
import { PostgresWalletSecurityLedger } from '../../dist/auth/postgres-wallet-security-ledger.js'
process.once('message', async (m) => {
  const db = new DatabaseService(process.env.TEST_LEDGER_URL)
  try {
    await db.onModuleInit()
    registerLedgerWitness(db.client, new LedgerWitness(db.client, m.id, m.root))
    const original = db.client.$transaction.bind(db.client)
    const pause = async () => {
      process.send({ stage: m.stage })
      await new Promise(() => {})
    }
    db.client.$transaction = async (work, options) => {
      const value = await original(async (tx) => {
        const result = await work(tx)
        if (m.stage === 'before-commit') await pause()
        return result
      }, options)
      if (m.stage === 'after-commit') await pause()
      return value
    }
    await new PostgresWalletSecurityLedger(db.client, m.id).prepare(m.change)
    process.send({ error: 'checkpoint not reached' })
  } catch (e) {
    process.send({ error: e.code ?? e.name })
  }
})
