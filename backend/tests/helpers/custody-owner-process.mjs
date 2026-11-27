import { publishWitnessCheckpoint } from '../../dist/auth/checkpoint-publisher.js'
import { Buffer } from 'node:buffer'
// Fresh isolated custodian process. Inputs are paths/IDs, not inherited closures.
// All key files are synthetic test materials; no .env or production fallback.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseService } from '../../dist/database/database.service.js'
import { restoreAuthorizedCustody } from '../../dist/auth/authorized-recovery.js'
import { stageWitnessRecovery } from '../../dist/auth/controlled-witness-recovery.js'
import { readSignedCheckpoint } from '../../dist/auth/recovery-authority.js'
import { LedgerWitness, registerLedgerWitness } from '../../dist/auth/ledger-witness.js'
import { PrivateLifecycleLedger } from '../../dist/delivery-files/deletion-ledger.js'
import { PrivateBackupService, pgChild } from '../../dist/delivery-files/private-backup.js'
import { PrivateRecoveryService } from '../../dist/delivery-files/private-recovery.js'
import { GaragePrivateObjectStore } from '../../dist/delivery-files/object-store.js'
import { DualChainObserver } from '../../dist/web3/chain-observer.js'
const clients = []
process.once('message', async ({ inputFile }) => {
  let report,
    authorizationTtlMs = null,
    stage = 'start'
  try {
    const i = JSON.parse(await readFile(inputFile, 'utf8'))
    await assert.rejects(
      readFile(join(i.originalDirectory, 'config-runtime')),
      (e) => e.code === 'EACCES'
    )
    const keys = Object.fromEntries(
      await Promise.all(
        Object.entries(i.keyFiles).map(async ([k, p]) => [
          k,
          Buffer.from((await readFile(p, 'utf8')).trim(), 'hex')
        ])
      )
    )
    const authorizationDocument = JSON.parse(
      await readFile(i.authorization.authorizationFile, 'utf8')
    ).payload
    const ttl =
      Date.parse(authorizationDocument.expiresAt) - Date.parse(authorizationDocument.issuedAt)
    authorizationTtlMs = Number.isFinite(ttl) ? ttl : null
    stage = 'authorized-decryption'
    const restored = await restoreAuthorizedCustody({ ...i.authorization, keys })
    await assert.rejects(restoreAuthorizedCustody({ ...i.authorization, keys }), /CONSUMED/)
    for (const k of Object.values(keys)) k.fill(0)
    const files = Object.fromEntries(restored.files.map((f) => [f.role + '-' + f.name, f.path]))
    const nonsecret = JSON.parse(await readFile(files['config-runtime'], 'utf8')),
      access = JSON.parse(await readFile(files['access-runtime'], 'utf8'))
    const c = nonsecret.config
    assert.equal(c.configurationVersion, i.authorization.configurationVersion)
    c.databaseUrl = access.databaseUrl
    c.web3.securityLedgerUrl = access.securityUrl
    c.privateFiles.store = { ...c.privateFiles.store, ...access.storeCredentials }
    c.privateFiles.uploadKey = Buffer.from(access.uploadKeyHex, 'hex')
    const security = new DatabaseService(access.securityUrl),
      privateDb = new DatabaseService(access.privateUrl)
    clients.push(security, privateDb)
    await security.onModuleInit()
    await privateDb.onModuleInit()
    const sourceUrls = { wallet: new URL(access.securityUrl), private: new URL(access.privateUrl) }
    for (const name of ['wallet', 'private']) {
      stage = 'native-' + name
      const u = sourceUrls[name],
        schema = u.searchParams.get('schema')
      if (!/^(wl|pl)_[a-f0-9]{32}$/.test(schema) || u.pathname !== '/bazaar_test')
        throw new Error('Isolated ledger restore required')
      const p = pgChild(
        'pg_restore',
        [
          '--clean',
          '--if-exists',
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '--schema=' + schema,
          '--dbname=' + u.pathname.slice(1),
          files['ledger-records-' + name]
        ],
        u
      )
      p.stdout.resume()
      await p.done
    }
    const candidates = {}
    for (const [name, client, id, sourceDirectory, namespace] of [
      ['wallet', security.client, nonsecret.securityId, nonsecret.walletSource, 'wallet'],
      ['private', privateDb.client, nonsecret.privateId, nonsecret.privateSource, 'private-files']
    ]) {
      stage = 'candidate-' + name
      const cp = i.checkpoints[name]
      assert.equal(cp.publicKeyFile, i.trustedPublicKeyFile)
      await readSignedCheckpoint(cp)
      candidates[name] = await stageWitnessRecovery({
        client,
        ledgerId: id,
        namespace,
        sourceDirectory,
        checkpointFile: cp.checkpointFile,
        environmentId: cp.environmentId,
        publicKeyFile: i.trustedPublicKeyFile,
        targetDirectory: join(i.restoredBase, name + '-witness'),
        outcome: 'head'
      })
    }
    const walletWitness = new LedgerWitness(
      security.client,
      nonsecret.securityId,
      candidates.wallet.directory,
      'wallet'
    )
    registerLedgerWitness(security.client, walletWitness)
    const privateLedger = new PrivateLifecycleLedger(
      privateDb.client,
      nonsecret.privateId,
      candidates.private.directory
    )
    const store = new GaragePrivateObjectStore(c.privateFiles.store),
      sourceUrl = new URL(access.databaseUrl)
    const source = new DatabaseService(sourceUrl.toString())
    clients.push(source) // no source ping/read
    const backup = new PrivateBackupService(
      source.client,
      sourceUrl,
      store,
      privateLedger,
      Buffer.from(access.backupKeyHex, 'hex'),
      nonsecret.backupRoot
    )
    const url = new URL(sourceUrl)
    url.pathname = '/' + i.targetDatabaseName
    const target = new DatabaseService(url.toString())
    clients.push(target)
    await target.onModuleInit()
    const recovery = new PrivateRecoveryService(
      backup,
      walletWitness,
      c.web3,
      new DualChainObserver(c.web3, c.web3.chainDeployment)
    )
    stage = 'business-restore'
    const initial = await recovery.restoreIsolated(nonsecret.backupId, target.client, url, store)
    assert.deepEqual(initial.missing, [])
    assert.equal(
      (await target.client.privateRecoveryState.findUniqueOrThrow({ where: { singleton: true } }))
        .status,
      'isolated'
    )
    stage = 'chain-reconciliation'
    await recovery.reconcile(target.client)
    const validation = await recovery.validate(target.client, store)
    assert.deepEqual(validation.missing, [])
    stage = 'opening'
    const opened = await recovery.open(target.client, store)
    const runtimeCheckpoints = {}
    for (const [name, witness] of [
      ['wallet', walletWitness],
      ['private', privateLedger.witness]
    ]) {
      const previous = await readSignedCheckpoint(i.checkpoints[name])
      runtimeCheckpoints[name] = (
        await publishWitnessCheckpoint({
          witness,
          environmentId: i.checkpoints[name].environmentId,
          publicDirectory: i.publicDirectory,
          publicKeyFile: i.trustedPublicKeyFile,
          privateKeyFile: i.checkpointSigningKeyFile,
          label: name + '-C3-' + i.authorization.recoveryId,
          parentCheckpointHash: previous.hash
        })
      ).options
    }
    const walletDescriptor = JSON.parse(
      await readFile(runtimeCheckpoints.wallet.configurationFile, 'utf8')
    )
    walletDescriptor.pairedPrivateConfigurationFile = runtimeCheckpoints.private.configurationFile
    await writeFile(runtimeCheckpoints.wallet.configurationFile, JSON.stringify(walletDescriptor), {
      mode: 0o644
    })
    runtimeCheckpoints.wallet.pairedPrivateConfigurationFile =
      runtimeCheckpoints.private.configurationFile
    c.databaseUrl = url.toString()
    delete c.privateFiles.uploadKey
    c.privateFiles.uploadKeyHex = access.uploadKeyHex
    c.web3.paymentSignerFile = files['payment-signer']
    c.web3.deliverySignerFile = files['delivery-signer']
    c.web3.securityWitnessDirectory = candidates.wallet.directory
    c.web3.securityCheckpoint = runtimeCheckpoints.wallet
    c.privateFiles.scratchRoot = join(i.restoredBase, 'scratch')
    await mkdir(c.privateFiles.scratchRoot, { mode: 0o700 })
    const trustedProfileFile = join(
      i.publicDirectory,
      'active-' + i.authorization.recoveryId + '.config'
    )
    await writeFile(trustedProfileFile, JSON.stringify(runtimeCheckpoints), {
      mode: 0o644,
      flag: 'wx'
    })
    const bootstrap = {
      config: c,
      securityUrl: access.securityUrl,
      securityId: nonsecret.securityId,
      witnessDirectory: candidates.wallet.directory,
      privateUrl: access.privateUrl,
      privateId: nonsecret.privateId,
      privateWitnessDirectory: candidates.private.directory,
      paymentFile: files['payment-signer'],
      deliveryFile: files['delivery-signer'],
      port: i.apiPort,
      uploadPort: i.uploadPort,
      trustedCheckpointOptions: runtimeCheckpoints
    }
    await writeFile(join(i.restoredBase, 'bootstrap.json'), JSON.stringify(bootstrap), {
      mode: 0o600
    })
    report = {
      ok: true,
      trustedProfileFile,
      runId: initial.runId,
      coordinatorOpenedAt: opened.openedAt,
      finalizedHeight: opened.height,
      finalizedHash: opened.hash,
      originalReadDenied: true,
      authorizationReplayDenied: true,
      authorizationTtlMs,
      recoveryId: restored.recoveryId,
      configurationVersion: restored.configurationVersion,
      checkpointHash: restored.checkpointHash,
      checkpointSequence: restored.checkpointSequence,
      postRecoveryCheckpoints: {
        wallet: JSON.parse(await readFile(runtimeCheckpoints.wallet.checkpointFile, 'utf8')),
        private: JSON.parse(await readFile(runtimeCheckpoints.private.checkpointFile, 'utf8'))
      },
      postRecoveryHistories: {
        wallet: JSON.parse(await readFile(runtimeCheckpoints.wallet.historyFile, 'utf8')),
        private: JSON.parse(await readFile(runtimeCheckpoints.private.historyFile, 'utf8'))
      }
    }
  } catch (e) {
    const allowed = new Set([
      'RECOVERY_CONSUMPTION_GUARD_REQUIRED',
      'PINNED_RECOVERY_AUTHORITY_REQUIRED',
      'RECOVERY_BUNDLE_CHANGED',
      'INVALID_RECOVERY_DOCUMENT',
      'INVALID_CHECKPOINT',
      'UNSAFE_RECOVERY_DOCUMENT',
      'INVALID_RECOVERY_SIGNATURE',
      'CHECKPOINT_MISMATCH',
      'CHECKPOINT_HISTORY_REQUIRED',
      'CHECKPOINT_HISTORY_MISMATCH',
      'INVALID_RECOVERY_AUTHORIZATION',
      'RECOVERY_AUTHORIZATION_MISMATCH',
      'RECOVERY_AUTHORIZATION_EXPIRED',
      'UNSAFE_AUTHORIZATION_RECEIPTS',
      'RECOVERY_AUTHORIZATION_CONSUMED',
      'Role custody restore rejected'
    ])
    report = {
      ok: false,
      errorCode: e.code ?? e.name,
      stage,
      diagnostic: allowed.has(e.message) ? e.message : 'UNCLASSIFIED',
      authorizationTtlMs
    }
  } finally {
    for (const c of clients.reverse()) await c.onModuleDestroy().catch(() => {})
    process.send?.(report, () => process.disconnect())
  }
})
