#!/usr/bin/env node
// This command never opens the restored service. Full probes and explicit owner
// opening are a separate step; no --force or arbitrary existing target.
import { readPrivateFileConfig } from '../dist/delivery-files/config.js'
import { GaragePrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { PrivateBackupService } from '../dist/delivery-files/private-backup.js'
import { PrivateRecoveryService } from '../dist/delivery-files/private-recovery.js'
import { LedgerWitness } from '../dist/auth/ledger-witness.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { DualChainObserver } from '../dist/web3/chain-observer.js'
import { protectedText } from '../dist/delivery-files/lifecycle-config.js'
import { lifecycleRuntime, backupKey } from './private-lifecycle-runtime.mjs'
if (
  process.argv.length !== 4 ||
  process.argv[2] !== '--confirm-isolated-restore' ||
  !process.env.PRIVATE_RESTORE_DATABASE_URL_FILE ||
  !process.env.PRIVATE_RESTORE_FILE_CONFIG_FILE ||
  !process.env.WEB3_SECURITY_LEDGER_OWNER_URL_FILE ||
  !process.env.PRIVATE_BACKUP_DIRECTORY
)
  throw new Error(
    'Explicit backupID, fresh restore DB, isolated file store, owner ledger credentials and backup directory required'
  )
const r = await lifecycleRuntime({ connectSource: false }),
  targetUrl = new URL(protectedText(process.env.PRIVATE_RESTORE_DATABASE_URL_FILE)),
  target = new DatabaseService(targetUrl.toString()),
  security = new DatabaseService(protectedText(process.env.WEB3_SECURITY_LEDGER_OWNER_URL_FILE))
try {
  await target.onModuleInit()
  await security.onModuleInit()
  const fileConfig = readPrivateFileConfig(
    { ...process.env, PRIVATE_FILE_CONFIG_FILE: process.env.PRIVATE_RESTORE_FILE_CONFIG_FILE },
    r.config.appOrigin
  )
  if (!fileConfig) throw new Error('Isolated restore file configuration required')
  if (
    fileConfig.store.endpoint === r.config.privateFiles.store.endpoint &&
    fileConfig.store.bucket === r.config.privateFiles.store.bucket
  )
    throw new Error('Restore must use a separate private bucket')
  const backup = new PrivateBackupService(
    r.source.client,
    r.sourceUrl,
    r.store,
    r.ledger,
    backupKey(),
    process.env.PRIVATE_BACKUP_DIRECTORY
  )
  const recovery = new PrivateRecoveryService(
    backup,
    new LedgerWitness(
      security.client,
      r.config.web3.securityLedgerId,
      r.config.web3.securityWitnessDirectory
    ),
    r.config.web3,
    new DualChainObserver(r.config.web3, r.config.web3.chainDeployment)
  )
  const result = await recovery.restoreIsolated(
    process.argv[3],
    target.client,
    targetUrl,
    new GaragePrivateObjectStore(fileConfig.store)
  )
  console.log(
    JSON.stringify({
      runId: result.runId,
      backupId: result.manifest.id,
      status: 'isolated',
      missing: result.missing
    })
  )
} finally {
  await target.onModuleDestroy()
  await security.onModuleDestroy()
  await r.close()
}
