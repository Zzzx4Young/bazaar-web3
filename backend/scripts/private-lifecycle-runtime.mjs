import {
  readPublicationOpening,
  runtimePublicationOptions
} from '../dist/auth/publication-runtime.js'
import { assertPrivateLedgerGrants } from '../dist/delivery-files/private-ledger-grants.js'
import {
  assertControlledRecoveryConfig,
  assertStoredRecoveryProfile
} from '../dist/auth/recovery-profile.js'
import { createWitnessCheckpointGuard } from '../dist/auth/recovery-authority.js'
import { Buffer } from 'node:buffer'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { PrivateLifecycleLedger } from '../dist/delivery-files/deletion-ledger.js'
import { GaragePrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { protectedText } from '../dist/delivery-files/lifecycle-config.js'
export async function lifecycleRuntime(options = {}) {
  const config = options.config ?? readConfig(process.env)
  assertControlledRecoveryConfig(config)
  if (
    !config.web3 ||
    !config.privateFiles ||
    !config.privateLifecycle ||
    !process.env.PRIVATE_BACKUP_DATABASE_URL_FILE
  )
    throw new Error(
      'Explicit Web3/private-file/lifecycle and protected backup database credentials required'
    )
  const sourceUrl = new URL(protectedText(process.env.PRIVATE_BACKUP_DATABASE_URL_FILE))
  const ledgerUrl = new URL(config.privateLifecycle.url)
  if (sourceUrl.host === ledgerUrl.host && sourceUrl.pathname === ledgerUrl.pathname)
    throw new Error('Lifecycle ledger cannot be restored with business database')
  const source = new DatabaseService(sourceUrl.toString()),
    ledgerDb = new DatabaseService(ledgerUrl.toString())
  try {
    if (options.connectSource !== false) {
      await source.onModuleInit()
      await assertStoredRecoveryProfile(source.client, config)
    }
    await ledgerDb.onModuleInit()
    if (config.web3.publication) await readPublicationOpening(config.web3.publication)
    if (config.privateLifecycle.publication) await assertPrivateLedgerGrants(ledgerDb.client, true)
    const ledger = new PrivateLifecycleLedger(
      ledgerDb.client,
      config.privateLifecycle.ledgerId,
      config.privateLifecycle.witnessDirectory,
      undefined,
      config.privateLifecycle.checkpoint
        ? createWitnessCheckpointGuard(config.privateLifecycle.checkpoint)
        : undefined,
      runtimePublicationOptions(
        config.privateLifecycle.publication,
        'private-files',
        config.privateLifecycle.ledgerId
      )
    )
    await ledger.verify()
    return {
      config,
      source,
      sourceUrl,
      ledger,
      store: new GaragePrivateObjectStore(config.privateFiles.store),
      async close() {
        await source.onModuleDestroy()
        await ledgerDb.onModuleDestroy()
      }
    }
  } catch (e) {
    await source.onModuleDestroy()
    await ledgerDb.onModuleDestroy()
    throw e
  }
}
export function backupKey() {
  const path = process.env.PRIVATE_BACKUP_KEY_FILE
  if (!path) throw new Error('Separate protected PRIVATE_BACKUP_KEY_FILE required')
  const key = protectedText(path)
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Backup key must contain64hex characters')
  return Buffer.from(key, 'hex')
}
