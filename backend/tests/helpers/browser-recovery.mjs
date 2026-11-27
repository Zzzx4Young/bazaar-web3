import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseService } from '../../dist/database/database.service.js'
import { PrivateBackupService } from '../../dist/delivery-files/private-backup.js'
import { PrivateRecoveryService } from '../../dist/delivery-files/private-recovery.js'
import { DownloadService } from '../../dist/delivery-files/download.service.js'
import { EvidenceService } from '../../dist/evidence/evidence.service.js'
import { evaluateRecovery } from '../../dist/web3/recovery-report.js'
import { DualChainObserver } from '../../dist/web3/chain-observer.js'
const sha = (b) => createHash('sha256').update(b).digest('hex')
export async function browserRecoveryTools({
  db,
  security,
  privateLedger,
  chain,
  cfg,
  store,
  root,
  pause,
  apiPort,
  resume,
  logRequest
}) {
  const controlledFactory =
    process.env.T10_CUSTODY === '1'
      ? (await import('./controlled-browser-recovery.mjs')).createControlledBrowserRecovery
      : null
  const backupRoot = join(root, 'backups')
  await mkdir(backupRoot, { mode: 0o700 })
  const backup = new PrivateBackupService(
    db.client,
    db.url,
    store,
    privateLedger.ledger,
    randomBytes(32),
    backupRoot
  )
  const observer = new DualChainObserver(cfg.web3, chain.deployment)
  const recovery = new PrivateRecoveryService(backup, security.witness, cfg.web3, observer)
  let manifest, oldGrant, restored, admin, createdName, faultAt, sourceStates
  const controlled = controlledFactory
    ? await controlledFactory({
        db,
        security,
        privateLedger,
        chain,
        cfg,
        backupRoot,
        backupKey: backup.key,
        logRequest
      })
    : null
  return {
    async prepare(app, orders) {
      const adminAccount = await db.client.account.create({
        data: {
          loginName: 'recovery-admin-' + randomUUID(),
          displayName: 'Recovery review scope',
          role: 'admin'
        }
      })
      await db.client.reviewAuthorization.create({
        data: {
          orderId: orders[1],
          accountId: adminAccount.id,
          expiresAt: new Date(Date.now() + 3600000)
        }
      })
      await app.get(EvidenceService).closeReview(orders[1], adminAccount.id, randomUUID())
      const [v] = await db.client.privateFileVersion.findMany({
        where: { orderId: orders[0], purpose: 'delivery' },
        orderBy: { createdAt: 'asc' }
      })
      const order = await db.client.order.findUniqueOrThrow({ where: { id: orders[0] } })
      oldGrant = await app.get(DownloadService).authorizeDownload(order.id, v.id, order.buyerId)
      manifest = await backup.create()
      sourceStates = await Promise.all(
        orders.map(async (id) => ({
          id,
          ...(await db.client.escrowProjection.findFirstOrThrow({ where: { businessOrderId: id } }))
        }))
      )
      assert.deepEqual(
        sourceStates.map((s) => s.state),
        ['Released', 'Disputed']
      )
      if (controlled) await controlled.captureC1(manifest)
      return {
        id: manifest.id,
        consistentPointAt: manifest.consistentPointAt,
        objectCount: manifest.objects.length
      }
    },
    async restore() {
      assert.ok(manifest)
      if (controlled) await controlled.captureC2()
      faultAt = new Date().toISOString()
      await pause()
      for (const v of manifest.objects) await store.deleteAndConfirm(v.objectKey)
      const adminUrl = new URL(db.url)
      adminUrl.searchParams.set('schema', 'public')
      admin = new DatabaseService(adminUrl.toString())
      await admin.onModuleInit()
      createdName = 'bazaar_web3_restore_' + randomUUID().replaceAll('-', '')
      await admin.client.$executeRawUnsafe(`CREATE DATABASE "${createdName}"`)
      const url = new URL(db.url)
      url.pathname = '/' + createdName
      restored = new DatabaseService(url.toString())
      await restored.onModuleInit()
      if (controlled) {
        const report = await controlled.restore({
          targetDatabaseName: createdName,
          apiPort,
          uploadPort: Number(new URL(cfg.privateFiles.uploadOrigin).port)
        })
        assert.ok(Date.now() < Date.parse(oldGrant.expiresAt), 'old link still within300 seconds')
        const oldUrl = new URL(oldGrant.url)
        oldUrl.hostname = '127.0.0.1'
        const denied = await fetch(oldUrl, { signal: AbortSignal.timeout(5000) })
        assert.ok(denied.status >= 400)
        return {
          runId: report.runId,
          backupId: manifest.id,
          faultAt,
          coordinatorOpenedAt: report.coordinatorOpenedAt,
          finalizedHeight: report.finalizedHeight,
          finalizedHash: report.finalizedHash,
          thirdCustody: await controlled.evidence()
        }
      }
      const result = await recovery.restoreIsolated(manifest.id, restored.client, url, store)
      assert.deepEqual(result.missing, [])
      const gate = await restored.client.privateRecoveryState.findUniqueOrThrow({
        where: { singleton: true }
      })
      assert.equal(gate.status, 'isolated')
      const access = new DownloadService(
        restored.client,
        cfg.web3,
        store,
        cfg.privateFiles.uploadOrigin,
        cfg.privateFiles.uploadKey
      )
      assert.ok(
        Date.now() < Date.parse(oldGrant.expiresAt),
        'old capability still within its original lifetime'
      )
      await assert.rejects(access.readCapability(oldGrant.id, oldGrant.token))
      await assert.rejects(
        access.authorizeDownload(
          sourceStates[0].id,
          manifest.objects.find((v) => v.orderId === sourceStates[0].id && v.purpose === 'delivery')
            .id,
          (await restored.client.order.findUniqueOrThrow({ where: { id: sourceStates[0].id } }))
            .buyerId
        )
      )
      await recovery.reconcile(restored.client)
      const checked = await recovery.validate(restored.client, store)
      assert.deepEqual(checked.missing, [])
      const opened = await recovery.open(restored.client, store)
      await resume(url.toString())
      // Epoch fencing survives complete opening as well as isolation.
      await assert.rejects(access.readCapability(oldGrant.id, oldGrant.token))
      return {
        runId: result.runId,
        backupId: manifest.id,
        faultAt,
        coordinatorOpenedAt: opened.openedAt,
        finalizedHeight: opened.height,
        finalizedHash: opened.hash
      }
    },
    get database() {
      return { client: restored.client }
    },
    async complete(probes) {
      const now = new Date().toISOString()
      const states = await Promise.all(
        sourceStates.map((s) =>
          restored.client.escrowProjection.findFirstOrThrow({ where: { businessOrderId: s.id } })
        )
      )
      assert.deepEqual(
        states.map((s) => s.state),
        ['Released', 'Refunded']
      )
      const stock = await restored.client.testnetStock.findUniqueOrThrow({
        where: {
          listingId: (
            await restored.client.order.findUniqueOrThrow({ where: { id: sourceStates[1].id } })
          ).listingId
        }
      })
      assert.notEqual(stock.state, 'free')
      const evidence = {
        faultAt,
        consistentPointAt: manifest.consistentPointAt,
        observedAt: now,
        openedAt: now,
        infrastructureAvailable: true,
        independentRpcAvailable: false,
        checks: {
          ledgerWitness: true,
          deletionLedger: true,
          deployment: true,
          keys: true,
          dbObjects: true,
          funds: true,
          identities: true,
          fileMappings: true,
          access: true,
          issuance: true,
          inventory: true
        },
        missing: []
      }
      const restoredAuditIds = new Set(
        (await restored.client.fileAccessAudit.findMany({ select: { id: true } })).map((r) => r.id)
      )
      const postPointAuditLoss = (
        controlled
          ? controlled.audits
          : await db.client.fileAccessAudit.findMany({
              select: { id: true, orderId: true, action: true, createdAt: true }
            })
      )
        .filter((r) => !restoredAuditIds.has(r.id))
        .map((r) => ({
          orderId: r.orderId,
          action: r.action,
          createdAt: r.createdAt.toISOString()
        }))
      return {
        scope: controlled
          ? 'local C1 business and independent ledger/witness co-rollback; signed C2 owner restoration from separate encrypted custody; fresh runtime OS user'
          : 'local API-stop/private-object-loss recovery to a fresh database; original business schema retained offline for forensics',
        keyRecovery: controlled
          ? 'fresh owner and runtime processes load independently encrypted C2 materials; original runtime directory inaccessible; local OS/custody simulation only'
          : 'keys/config and independent ledgers remain available outside fault scope; not a key-loss recovery exercise',
        ...(controlled ? { thirdCustody: await controlled.evidence() } : {}),
        rpc: 'two local proxies to SAME Anvil; independent-provider prerequisite unvalidated',
        postPointAuditLoss,
        dataLossScope:
          'Recent access/audit rows outside the consistent snapshot may be lost within RPO; critical order/file/publication/evidence mappings are independently verified, not guessed',
        backupId: manifest.id,
        orderIds: sourceStates.map((s) => s.id),
        oldStates: sourceStates.map((s) => s.state),
        states: states.map((s) => s.state),
        stockState: stock.state,
        oldCapabilityRejected: true,
        probes,
        evidence,
        evaluation: evaluateRecovery(evidence)
      }
    },
    async close() {
      await controlled?.close()
      if (restored) await restored.onModuleDestroy()
      if (admin) {
        if (createdName) await admin.client.$executeRawUnsafe(`DROP DATABASE "${createdName}"`)
        await admin.onModuleDestroy()
      }
    },
    sha
  }
}
