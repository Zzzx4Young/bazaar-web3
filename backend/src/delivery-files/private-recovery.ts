import { assertPublicationOpening } from '../auth/publication-runtime.js'
import { RetentionService } from './retention.service.js'
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { LedgerWitness } from '../auth/ledger-witness.js'
import { PostgresWalletSecurityLedger } from '../auth/postgres-wallet-security-ledger.js'
import type { Web3Config, OrderTerms } from '../web3/web3-types.js'
import type { ObservedOrder } from '../web3/escrow-state.js'
import { DualChainObserver, stable } from '../web3/chain-observer.js'
import { PostgresPaymentJournal } from '../web3/payment-journal.js'
import { ChainIndexer } from '../web3/chain-indexer.js'
import { RefundJournal } from '../web3/refund-journal.js'
import { RefundRecoveryService } from '../web3/refund-recovery.service.js'
import { chainScope, lockChain, deploymentDigest } from '../web3/escrow-projector.js'
import { PrivateBackupService, privateRoot, pgChild } from './private-backup.js'
import { decryptBackupPart, encryptedPartHash } from './backup-crypto.js'
import type { PrivateObjectStore } from './object-store.js'
import {
  digest,
  resolveFirstMappingIdentity,
  verifyObject,
  checkedVersion,
  fileManifest,
  commitment
} from './authorization.js'
import { verifyPublicationSignature } from './supplement-publication.service.js'
import { persistPrivateFinality } from './lifecycle-projection.js'

export class PrivateRecoveryService {
  constructor(
    readonly backup: PrivateBackupService,
    readonly walletWitness: LedgerWitness,
    readonly config: Web3Config,
    readonly observer: DualChainObserver
  ) {}
  async restoreIsolated(id: string, target: PrismaClient, url: URL, store: PrivateObjectStore) {
    const manifest = await this.backup.read(id)
    await this.walletWitness.verify()
    if (
      url.pathname === this.backup.url.pathname ||
      !/^\/bazaar_web3_restore_[a-f0-9]{16,40}$/.test(url.pathname) ||
      url.searchParams.get('schema') !== manifest.schema
    )
      throw new Error('Explicit fresh isolated restore database required')
    const [occupied] = await target.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*)::bigint AS n FROM information_schema.tables WHERE table_schema=${manifest.schema}`
    if (occupied.n !== 0n) throw new Error('Restore schema is not empty')
    const runId = randomUUID(),
      scratch = await mkdtemp(join(this.backup.root, '.restore-')),
      missing: string[] = []
    const directory = join(this.backup.root, id)
    await privateRoot(directory)
    try {
      if ((await encryptedPartHash(directory, 'database')) !== manifest.databaseHash)
        throw new Error('Database backup changed')
      const dump = join(scratch, 'database')
      await decryptBackupPart(directory, id, 'database', this.backup.key, dump)
      await target.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${manifest.schema}"`)
      const restore = pgChild(
        'pg_restore',
        [
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '--dbname=' + url.pathname.slice(1),
          '--schema=' + manifest.schema,
          dump
        ],
        url
      )
      restore.stdout.resume()
      await restore.done
      await rm(dump)
      await target.privateRecoveryState.upsert({
        where: { singleton: true },
        create: {
          singleton: true,
          runId,
          backupId: id,
          downloadEpoch: randomUUID(),
          status: 'isolated',
          checks: { database: url.pathname }
        },
        update: {
          runId,
          backupId: id,
          downloadEpoch: randomUUID(),
          status: 'isolated',
          checks: { database: url.pathname }
        }
      })
      await target.scanCheckpoint.updateMany({ data: { status: 'recovering' } })
      const now = new Date()
      await target.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } })
      await target.walletChallenge.updateMany({
        where: { consumedAt: null },
        data: { invalidatedAt: now }
      })
      await target.emailCodeChallenge.updateMany({
        where: { consumedAt: null },
        data: { consumedAt: now }
      })
      await target.googleOAuthAttempt.updateMany({
        where: { consumedAt: null },
        data: { consumedAt: now }
      })
      const deleted = await this.backup.ledger.records('claim'),
        byVersion = new Map(deleted.map((r) => [r.key, r]))
      const confirmations = new Map(
        (await this.backup.ledger.records('deleted')).map((r) => [r.key, r])
      )
      for (const v of manifest.objects) {
        const tombstone = byVersion.get(v.id)
        if (tombstone) {
          if (
            tombstone.payload.objectKey !== v.objectKey ||
            tombstone.payload.objectVersion !== v.objectVersion ||
            tombstone.payload.sha256 !== v.sha256
          )
            throw new Error('Deletion ledger object mapping differs')
          await store.deleteAndConfirm(v.objectKey)
          await target.privateFileDisposition.upsert({
            where: { versionId: v.id },
            create: {
              versionId: v.id,
              claimId: String(tombstone.payload.claimId),
              state: confirmations.has(v.id) ? 'deleted' : 'claimed',
              deadline: new Date(String(tombstone.payload.deadline))
            },
            update: {}
          })
          if (confirmations.has(v.id))
            await target.privateUpload.update({
              where: { id: v.uploadId },
              data: {
                status: 'cleaned',
                cleanedAt: new Date(String(confirmations.get(v.id)!.payload.deletedAt))
              }
            })
          else missing.push('unconfirmed deletion:' + v.id)
          continue
        }
        if ((await encryptedPartHash(directory, v.part)) !== v.encryptedHash)
          throw new Error('Object backup changed')
        const output = join(scratch, v.id)
        await decryptBackupPart(directory, id, v.part, this.backup.key, output)
        const hash = createHash('sha256')
        let size = 0
        for await (const b of createReadStream(output)) {
          size += b.length
          hash.update(b)
        }
        if (size !== v.byteSize || hash.digest('hex') !== v.sha256)
          throw new Error('Restored private object differs')
        await store.putOnce(v.objectKey, createReadStream(output), v.byteSize, v.contentType)
        await rm(output)
      }
      const versions = await target.privateFileVersion.findMany()
      const copied = new Set(manifest.objects.map((v) => v.id))
      for (const v of versions) {
        const upload = await target.privateUpload.findUniqueOrThrow({ where: { id: v.uploadId } })
        if (upload.status === 'ready' && !copied.has(v.id)) missing.push('unbacked version:' + v.id)
      }
      const walletState = await this.walletWitness.run(async (tx) => {
        const heads = await tx.$queryRaw<
          {
            accountId: string
            chainId: number
            address: string | null
            bindingVersion: number
            revision: bigint
            pendingOperationId: string | null
            payout: unknown
          }[]
        >`SELECT * FROM "WalletLedgerAccount"`
        const claims = await tx.$queryRaw<
          { accountId: string; chainId: number; address: string }[]
        >`SELECT * FROM "WalletLedgerClaim"`
        const [meta] = await tx.$queryRaw<
          { recoveryEpoch: string }[]
        >`SELECT "recoveryEpoch" FROM "WalletLedgerMeta" WHERE "singleton"=true`
        const newEpoch = randomUUID()
        await tx.$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch"=${newEpoch}::uuid WHERE "singleton"=true`
        return { heads, claims, epoch: newEpoch, previousEpoch: meta.recoveryEpoch }
      })
      for (const h of walletState.heads) {
        if (h.pendingOperationId) {
          missing.push('pending wallet operation:' + h.accountId)
          continue
        }
        if (!(await target.account.findUnique({ where: { id: h.accountId } }))) {
          missing.push('wallet account missing:' + h.accountId)
          continue
        }
        // Clear stale address projections first so address reuse within the same
        // account binding history cannot trip a transient unique constraint.
        await target.walletIdentity.updateMany({
          where: { accountId: h.accountId, chainId: h.chainId },
          data: { address: null }
        })
        await target.walletIdentity.upsert({
          where: { accountId_chainId: { accountId: h.accountId, chainId: h.chainId } },
          create: {
            accountId: h.accountId,
            chainId: h.chainId,
            address: h.address,
            bindingVersion: h.bindingVersion,
            securityRevision: h.revision
          },
          update: {
            address: h.address,
            bindingVersion: h.bindingVersion,
            securityRevision: h.revision
          }
        })
        const payout = h.payout as { confirmationId?: string } | null
        await target.sellerPayoutConfirmation.updateMany({
          where: {
            accountId: h.accountId,
            chainId: h.chainId,
            ...(payout?.confirmationId ? { id: { not: payout.confirmationId } } : {})
          },
          data: { revokedAt: now }
        })
        if (
          payout?.confirmationId &&
          !(await target.sellerPayoutConfirmation.findUnique({
            where: { id: payout.confirmationId }
          }))
        )
          missing.push('payout evidence missing:' + h.accountId)
      }
      for (const c of walletState.claims) {
        if (!(await target.account.findUnique({ where: { id: c.accountId } }))) {
          missing.push('claim account missing:' + c.accountId)
          continue
        }
        const old = await target.walletClaim.findUnique({
          where: { chainId_address: { chainId: c.chainId, address: c.address } }
        })
        if (old && old.accountId !== c.accountId) {
          missing.push('wallet owner conflict:' + c.address)
          continue
        }
        await target.walletClaim.upsert({
          where: { chainId_address: { chainId: c.chainId, address: c.address } },
          create: { accountId: c.accountId, chainId: c.chainId, address: c.address },
          update: {}
        })
      }
      // Quotas are projections. Count retained ready versions, never charge deleted
      // copies or blindly trust counters restored before a later deletion.
      for (const q of await target.privateFileQuota.findMany()) {
        const active = await target.privateUpload.findMany({
          where: { accountId: q.accountId, status: 'ready' }
        })
        const pending = await target.privateUpload.findMany({
          where: {
            accountId: q.accountId,
            status: { in: ['uploading', 'receiving', 'quarantined', 'checking', 'cleanup_pending'] }
          }
        })
        if (pending.length) missing.push('unfinished upload recovery:' + q.accountId)
        await target.privateFileQuota.update({
          where: { accountId: q.accountId },
          data: { usedBytes: active.reduce((n, u) => n + BigInt(u.actualBytes ?? 0), 0n) }
        })
      }
      const quotas = await target.privateFileQuota.findMany()
      await target.privateFileGlobal.updateMany({
        data: { usedBytes: quotas.reduce((n, q) => n + q.usedBytes, 0n) }
      })
      await this.backup.ledger.append('restore', runId + ':isolated', {
        runId,
        backupId: id,
        recoveryEpoch: walletState.epoch,
        createdAt: now.toISOString(),
        missing
      })
      await target.privateRecoveryState.update({
        where: { singleton: true },
        data: { checks: { missing, database: url.pathname } }
      })
      return { runId, manifest, missing }
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
  async reconcile(target: PrismaClient) {
    await this.walletWitness.verify()
    await this.backup.ledger.verify()
    const journal = new PostgresPaymentJournal(
      this.walletWitness.client,
      this.walletWitness.ledgerId
    )
    const recovery = new RefundRecoveryService(
      target,
      this.observer,
      journal,
      new RefundJournal(this.walletWitness.client, this.walletWitness.ledgerId)
    )
    const indexer = new ChainIndexer(
      target,
      this.observer,
      () => journal.assertBusinessBasis(target, chainScope(this.config)),
      (r) => journal.assertResolutions(r, this.observer),
      () => recovery.runOnce(),
      persistPrivateFinality(this.backup.ledger, chainScope(this.config))
    )
    return indexer.runOnce()
  }
  async reconcileRetention(target: PrismaClient, store: PrivateObjectStore) {
    const gate = await target.privateRecoveryState.findUniqueOrThrow({ where: { singleton: true } })
    if (gate.status === 'active') return
    const composite: PrivateObjectStore = {
      read: store.read.bind(store),
      putOnce: store.putOnce.bind(store),
      assertRetentionSafety: async () => {
        if (!store.assertRetentionSafety || !this.backup.store.assertRetentionSafety)
          throw new Error('All recovery copy stores must support verified retention deletion')
        await store.assertRetentionSafety()
        if (store !== this.backup.store) await this.backup.store.assertRetentionSafety()
      },
      deleteAndConfirm: async (key) => {
        await store.deleteAndConfirm(key)
        if (store !== this.backup.store) await this.backup.store.deleteAndConfirm(key)
      }
    }
    const retention = new RetentionService(
      target,
      this.config,
      composite,
      this.backup.ledger,
      () => new Date(),
      gate.runId
    )
    for (const v of await target.privateFileVersion.findMany()) {
      if (
        (await target.privateFileDisposition.findUnique({ where: { versionId: v.id } }))?.state ===
        'deleted'
      )
        continue
      const eligible = await retention.eligibility(v.id)
      if (eligible.eligible) {
        const c = await retention.claimDeletion(v.id)
        await retention.confirmDeletion(c.id)
      }
    }
  }
  async validate(target: PrismaClient, store: PrivateObjectStore) {
    const missing: string[] = []
    const watermark = await this.backup.ledger.watermark()
    await this.walletWitness.verify()
    await this.backup.ledger.verify()
    const scope = chainScope(this.config),
      h = await this.observer.readVerifiedSnapshot()
    await this.observer.verifyDeployment(h)
    const cursor = await target.scanCheckpoint.findUnique({ where: { scope } })
    if (
      !cursor ||
      cursor.height !== BigInt(h.height) ||
      cursor.hash !== h.hash ||
      cursor.configHash !== deploymentDigest(this.config, this.observer.deployment)
    )
      throw new Error('Current common finalized checkpoint required')
    const gate = await target.privateRecoveryState.findUniqueOrThrow({ where: { singleton: true } })
    missing.push(...((gate.checks as { missing?: string[] }).missing ?? []))
    const journal = new PostgresPaymentJournal(
      this.walletWitness.client,
      this.walletWitness.ledgerId
    )
    await journal.assertBusinessBasis(target, scope)
    const wallet = new PostgresWalletSecurityLedger(
      this.walletWitness.client,
      this.walletWitness.ledgerId
    )
    for (const identity of await target.walletIdentity.findMany())
      await wallet.assertProjection({
        accountId: identity.accountId,
        chainId: identity.chainId,
        address: identity.address as `0x${string}` | null,
        bindingVersion: identity.bindingVersion,
        revision: identity.securityRevision.toString()
      })
    for (const v of await target.privateFileVersion.findMany()) {
      const tombstone = await this.backup.ledger.find('claim', v.id)
      if (tombstone) {
        if (!(await target.privateFileDisposition.findUnique({ where: { versionId: v.id } })))
          missing.push('deletion fence missing:' + v.id)
        continue
      }
      try {
        await verifyObject(store, v)
      } catch {
        missing.push('private bytes missing:' + v.id)
      }
    }
    for (const p of await target.escrowProjection.findMany({ where: { scope } })) {
      if (!p.businessOrderId) {
        missing.push('order mapping missing:' + p.chainOrderId)
        continue
      }
      const [order, t] = await Promise.all([
        target.order.findUnique({ where: { id: p.businessOrderId } }),
        target.paymentOrderTerms.findUnique({ where: { orderId: p.businessOrderId } })
      ])
      if (!order || !t) {
        missing.push('private terms missing:' + p.chainOrderId)
        continue
      }
      const state = p.data as unknown as ObservedOrder
      if (
        p.height !== cursor.height ||
        p.blockHash !== cursor.hash ||
        p.holdReason ||
        stable(state) !== stable(await this.observer.readOrder(p.chainOrderId as `0x${string}`, h))
      )
        throw new Error('Order does not match current finalized state')
      if (state.deliveredAt !== '0') {
        try {
          await target.$transaction(
            async (tx) => {
              await lockChain(tx, scope)
              const context = {
                order,
                cursor,
                terms: t.terms as unknown as OrderTerms,
                state,
                projection: p
              }
              const first = await resolveFirstMappingIdentity(tx, context)
              const deleted = await this.backup.ledger.find('deleted', first.version.id)
              if (!deleted) await verifyObject(store, first.version)
              else if (
                (
                  await tx.privateFileDisposition.findUnique({
                    where: { versionId: first.version.id }
                  })
                )?.state !== 'deleted'
              )
                throw new Error('Historical deletion fence missing')
              for (const publication of await tx.supplementPublication.findMany({
                where: { orderId: order.id }
              })) {
                const mapping = await tx.deliveryMapping.findUnique({
                    where: { id: publication.mappingId }
                  }),
                  challenge = await tx.supplementChallenge.findUnique({
                    where: { id: publication.authorizationId }
                  })
                if (
                  !mapping ||
                  !challenge ||
                  challenge.mappingId !== mapping.id ||
                  mapping.orderId !== order.id
                )
                  throw new Error('Supplement mapping missing')
                await verifyPublicationSignature(
                  this.config,
                  challenge,
                  publication.signature as `0x${string}`,
                  context.terms.seller,
                  {
                    orderId: order.id,
                    actorId: order.sellerId,
                    chainOrderId: context.terms.orderId,
                    deliveryVersion: mapping.deliveryVersion,
                    manifestCommitment: mapping.manifestCommitment
                  }
                )
                const removed = await this.backup.ledger.find('deleted', mapping.versionId)
                const v = removed
                  ? await tx.privateFileVersion.findUniqueOrThrow({
                      where: { id: mapping.versionId }
                    })
                  : await checkedVersion(
                      tx,
                      order.id,
                      mapping.versionId,
                      order.sellerId,
                      'delivery'
                    )
                if (
                  v.orderId !== order.id ||
                  v.ownerId !== order.sellerId ||
                  v.purpose !== 'delivery'
                )
                  throw new Error('Supplement version ownership differs')
                if (
                  digest(fileManifest(v)) !== digest(mapping.manifest) ||
                  commitment(mapping.manifest, mapping.salt) !== mapping.manifestCommitment ||
                  digest((publication.evidence as { message: unknown }).message) !==
                    digest(challenge.message)
                )
                  throw new Error('Supplement evidence differs')
              }
            },
            { timeout: 60000 }
          )
        } catch {
          missing.push('delivery mapping incomplete:' + order.id)
        }
      }
      const stock = await target.testnetStock.findUnique({ where: { listingId: t.listingId } })
      if (
        ['Released', 'Refunded'].includes(state.state) &&
        state.deliveredAt !== '0' &&
        stock?.state === 'free'
      )
        throw new Error('Registered stock must remain unavailable')
    }
    for (const r of await this.backup.ledger.records('delivery')) {
      const mapping = await target.deliveryMapping.findUnique({ where: { id: r.key } })
      const signature =
        mapping && (await target.deliverySignature.findUnique({ where: { mappingId: mapping.id } }))
      if (
        !mapping ||
        !signature ||
        mapping.versionId !== r.payload.versionId ||
        mapping.orderId !== r.payload.orderId ||
        digest(mapping.permit) !== r.payload.permitHash ||
        digest(signature.signature) !== r.payload.signatureHash
      )
        missing.push('independent delivery reference missing:' + r.key)
    }
    for (const r of await this.backup.ledger.records('publication')) {
      const pub = await target.supplementPublication.findUnique({
        where: { authorizationId: r.key }
      })
      if (
        !pub ||
        pub.orderId !== r.payload.orderId ||
        pub.mappingId !== r.payload.mappingId ||
        digest(pub.signature) !== r.payload.signatureHash
      )
        missing.push('independent publication missing:' + r.key)
    }
    for (const r of await this.backup.ledger.records('evidence')) {
      const e = await target.evidenceRecord.findUnique({ where: { id: r.key } })
      if (
        !e ||
        e.orderId !== r.payload.orderId ||
        digest({
          text: e.text,
          versionId: e.versionId,
          deliveryReferenceId: e.deliveryReferenceId,
          parentId: e.parentId
        }) !== r.payload.bodyHash
      )
        missing.push('independent evidence missing:' + r.key)
    }
    const latestReviews = new Map(
      (await this.backup.ledger.records('review')).map((r) => [r.payload.orderId, r])
    )
    for (const [orderId, r] of latestReviews) {
      const e = await target.reviewEvent.findFirst({
        where: { orderId: String(orderId) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })
      if (
        !e ||
        e.id !== r.key ||
        e.action !== r.payload.action ||
        e.createdAt.toISOString() !== r.payload.createdAt
      )
        missing.push('latest independent review missing:' + String(orderId))
    }
    for (const e of await target.evidenceRecord.findMany()) {
      if (!e.versionId) continue
      const v = await target.privateFileVersion.findUnique({ where: { id: e.versionId } })
      if (!v || v.orderId !== e.orderId || v.ownerId !== e.submitterId || v.purpose !== 'evidence')
        missing.push('evidence attachment mapping:' + e.id)
    }
    if (await target.session.count({ where: { revokedAt: null } }))
      missing.push('old sessions not invalidated')
    if ((await this.backup.ledger.watermark()) !== watermark)
      missing.push('private lifecycle changed during validation')
    const checked = {
      watermark,
      controlledRecovery:
        this.config.controlledRecovery === true ||
        (gate.checks as { controlledRecovery?: boolean }).controlledRecovery === true,
      database: (gate.checks as { database?: string }).database ?? '',
      missing: [...new Set(missing)],
      height: h.height,
      hash: h.hash,
      checkedAt: new Date().toISOString()
    }
    await target.privateRecoveryState.update({
      where: { singleton: true },
      data: { status: missing.length ? 'isolated' : 'verified', checks: checked }
    })
    return checked
  }
  async open(target: PrismaClient, store: PrivateObjectStore) {
    await assertPublicationOpening(this.config.publication)
    const before = await target.privateRecoveryState.findUniqueOrThrow({
      where: { singleton: true }
    })
    if (before.status === 'active') {
      await this.walletWitness.verify()
      const old = await this.backup.ledger.find('restore', before.runId + ':open')
      if (!old) throw new Error('Opening operation evidence missing')
      return { openedAt: before.updatedAt.toISOString(), ...(before.checks as object) }
    }
    await this.reconcileRetention(target, store)
    const checked = await this.validate(target, store)
    if (checked.missing.length)
      throw new Error('Recovery is incomplete: ' + checked.missing.join(','))
    await this.walletWitness.verify()
    const gate = await target.privateRecoveryState.findUniqueOrThrow({ where: { singleton: true } })
    const old = await this.backup.ledger.find('restore', gate.runId + ':open')
    await target.$transaction(
      async (tx) => {
        await lockChain(tx, chainScope(this.config))
        const cursor = await tx.scanCheckpoint.findUniqueOrThrow({
          where: { scope: chainScope(this.config) }
        })
        if (cursor.height !== BigInt(checked.height) || cursor.hash !== checked.hash)
          throw new Error('Recovery checkpoint changed')
        await this.backup.ledger.fence(checked.watermark, async (append) => {
          await append(
            gate.runId + ':open',
            old?.payload ?? {
              runId: gate.runId,
              backupId: gate.backupId,
              height: checked.height,
              hash: checked.hash,
              checkedAt: checked.checkedAt
            }
          )
          await tx.scanCheckpoint.update({
            where: { scope: cursor.scope },
            data: { status: 'active' }
          })
          await assertPublicationOpening(this.config.publication)
          await tx.privateRecoveryState.update({
            where: { singleton: true },
            data: { status: 'active' }
          })
        })
      },
      { timeout: 60000 }
    )
    return { openedAt: new Date().toISOString(), ...checked }
  }
}
