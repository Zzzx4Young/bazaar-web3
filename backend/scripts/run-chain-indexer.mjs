#!/usr/bin/env node
import { assertStoredRecoveryProfile } from '../dist/auth/recovery-profile.js'
import { createWitnessCheckpointGuard } from '../dist/auth/recovery-authority.js'
import { assertPrivateLedgerGrants } from '../dist/delivery-files/private-ledger-grants.js'
import { PrivateLifecycleLedger } from '../dist/delivery-files/deletion-ledger.js'
import { persistPrivateFinality } from '../dist/delivery-files/lifecycle-projection.js'
import { requireLedgerWitness } from '../dist/auth/ledger-witness.js'
import { RefundJournal } from '../dist/web3/refund-journal.js'
import { RefundRecoveryService } from '../dist/web3/refund-recovery.service.js'
import { DomainError } from '../dist/common/domain-error.js'
import { setTimeout as delay } from 'node:timers/promises'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { PostgresWalletSecurityLedger } from '../dist/auth/postgres-wallet-security-ledger.js'
import { DualChainObserver, ChainVerificationError } from '../dist/web3/chain-observer.js'
import { PostgresPaymentJournal } from '../dist/web3/payment-journal.js'
import { ChainIndexer } from '../dist/web3/chain-indexer.js'
const args = process.argv.slice(2)
if (
  args.some((a) => !['--once', '--initialize-fresh', '--initialize-recovery'].includes(a)) ||
  (args.includes('--initialize-fresh') && args.includes('--initialize-recovery'))
)
  throw new Error('Invalid indexer arguments')
const config = readConfig(process.env),
  web3 = config.web3
if (!web3?.chainDeployment)
  throw new Error('Explicit WEB3_CHAIN_DEPLOYMENT_FILE and Web3 configuration required')
const businessUrl = new URL(config.databaseUrl),
  securityUrl = new URL(web3.securityLedgerUrl)
if (businessUrl.host === securityUrl.host && businessUrl.pathname === securityUrl.pathname)
  throw new Error('Runtime indexer requires independent security database')
const db = new DatabaseService(config.databaseUrl, config.databasePool),
  security = new DatabaseService(web3.securityLedgerUrl, { ...config.databasePool, max: 2 })
const privateDb = config.privateLifecycle
  ? new DatabaseService(config.privateLifecycle.url, { ...config.databasePool, max: 2 })
  : null
await db.onModuleInit()
await assertStoredRecoveryProfile(db.client,config)
try {
  await security.onModuleInit()
  let privateLedger
  if (privateDb && config.privateLifecycle) {
    const u = new URL(config.privateLifecycle.url)
    if (u.host === businessUrl.host && u.pathname === businessUrl.pathname)
      throw new Error('Independent private ledger required')
    await privateDb.onModuleInit()
    privateLedger = new PrivateLifecycleLedger(
      privateDb.client,
      config.privateLifecycle.ledgerId,
      config.privateLifecycle.witnessDirectory,
          undefined,
          config.privateLifecycle.checkpoint ? createWitnessCheckpointGuard(config.privateLifecycle.checkpoint) : undefined
    )
    await assertPrivateLedgerGrants(privateDb.client)
    await privateLedger.verify()
  }
  const witness = requireLedgerWitness(security.client, web3)
  await witness.verify()
  const ledger = new PostgresWalletSecurityLedger(security.client, web3.securityLedgerId)
  await ledger.recoveryEpoch()
  const observer = new DualChainObserver(web3, web3.chainDeployment),
    journal = new PostgresPaymentJournal(security.client, web3.securityLedgerId),
    refundRecovery = new RefundRecoveryService(
      db.client,
      observer,
      journal,
      new RefundJournal(security.client, web3.securityLedgerId)
    ),
    indexer = new ChainIndexer(
      db.client,
      observer,
      () => journal.assertBusinessBasis(db.client, web3.chainId + ':' + web3.escrow),
      (range) => journal.assertResolutions(range, observer),
      async () => {
        try {
          return await refundRecovery.runOnce()
        } catch (e) {
          if (e instanceof DomainError)
            throw new ChainVerificationError(
              'unavailable',
              'refund recovery basis unavailable; stock retained'
            )
          throw e
        }
      },
      privateLedger
        ? persistPrivateFinality(privateLedger, web3.chainId + ':' + web3.escrow)
        : undefined
    )
  if (args.includes('--initialize-fresh')) {
    // Owner-controlled, new-deployment-only action; never an automatic reset or recovery approval.
    const [row] = await security.client
      .$queryRaw`SELECT count(*)::int AS count FROM "PaymentLedgerIntent" WHERE "scope"=${indexer.projector.scope}`
    if (row.count !== 0)
      throw new Error('Independent issuance history exists; fresh initialization forbidden')
    const snapshot = await observer.readVerifiedSnapshot()
    await observer.verifyDeployment(snapshot)
    const scanned = await observer.scanAndVerify(web3.chainDeployment.deploymentBlock, [])
    if (
      scanned.events.some((e) => ['Deposited', 'IntentRevoked'].includes(e.name)) ||
      BigInt(scanned.globals.totalDeposited) !== 0n ||
      scanned.snapshot.height !== snapshot.height
    )
      throw new Error('Nonempty or incomplete chain history requires recovery isolation')
    await indexer.projector.initialize('fresh')
  } else if (args.includes('--initialize-recovery')) await indexer.projector.initialize('recovery')
  let stopped = false
  process.on('SIGINT', () => {
    stopped = true
  })
  process.on('SIGTERM', () => {
    stopped = true
  })
  do {
    try {
      const result = await indexer.runOnce()
      console.log(JSON.stringify({ event: 'chain_scan', ...result }))
    } catch (e) {
      if (!(e instanceof ChainVerificationError)) throw e
      console.error(
        JSON.stringify({ event: 'chain_verification_paused', kind: e.kind, reason: e.reason })
      )
      if (args.includes('--once')) {
        process.exitCode = 1
        break
      }
    }
    if (args.includes('--once')) break
    if (!stopped) await delay(1000)
  } while (!stopped)
} finally {
  await privateDb?.onModuleDestroy()
  await security.onModuleDestroy()
  await db.onModuleDestroy()
}
