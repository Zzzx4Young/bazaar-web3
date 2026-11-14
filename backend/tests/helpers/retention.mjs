import { randomUUID, createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testnetFixture } from './testnet.mjs'
import { isolatedPrivateLedger } from './private-ledger.mjs'
import { LocalPrivateObjectStore } from '../../dist/delivery-files/object-store.js'
import { chainScope, deploymentDigest } from '../../dist/web3/escrow-projector.js'
const h = (n) => '0x' + n.toString(16).padStart(64, '0')
export async function retentionFixture() {
  const t = await testnetFixture(),
    p = await isolatedPrivateLedger(),
    root = await mkdtemp(join(tmpdir(), 'bazaar-retention-'))
  try {
    await t.bind()
    await t.confirm()
    await t.price('1')
    const orderId = await t.create(),
      scope = chainScope(t.config),
      store = new LocalPrivateObjectStore(root)
    const deployment = {
      deploymentBlock: '0',
      escrowCodeHash: h(1),
      tokenCodeHash: h(2),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    t.config.chainDeployment = deployment
    const terms = {
      chainId: t.config.chainId,
      escrow: t.config.escrow,
      token: t.config.token,
      orderId: h(10),
      stockId: h(11),
      stockGeneration: '0',
      previousOrderId: h(0),
      seller: t.w.address.toLowerCase(),
      buyer: '0x' + '5'.repeat(40),
      refundAddress: '0x' + '5'.repeat(40),
      amountAtoms: '1000000',
      commitmentHash: h(12)
    }
    await t.db.client.testnetStock.create({
      data: {
        listingId: t.f.listing.id,
        stockId: terms.stockId,
        previousOrderId: terms.previousOrderId,
        activeOrderId: orderId,
        state: 'protected'
      }
    })
    const intentId = randomUUID()
    await t.db.client.$transaction(async (tx) => {
      await tx.paymentOrderTerms.create({
        data: {
          orderId,
          listingId: t.f.listing.id,
          stockId: h(11),
          terms,
          termsHash: h(12),
          recoveryEpoch: t.security.epoch,
          initialIntentId: intentId
        }
      })
      await tx.paymentIntent.create({
        data: { id: intentId, orderId, permit: terms, digest: h(12) }
      })
    })
    await t.db.client.scanCheckpoint.create({
      data: {
        scope,
        configHash: deploymentDigest(t.config, deployment),
        deploymentBlock: 0n,
        height: 10n,
        hash: h(13),
        status: 'active',
        globals: { paused: false }
      }
    })
    await t.db.client.chainBlock.create({
      data: { scope, height: 10n, hash: h(13), parentHash: h(12), timestamp: 100n }
    })
    await t.db.client.chainSnapshot.create({
      data: {
        scope,
        height: 10n,
        hash: h(13),
        ordersHash: 'a'.repeat(64),
        stocksHash: 'b'.repeat(64),
        globals: { paused: false }
      }
    })
    const state = {
      ...terms,
      state: 'Released',
      fundedAt: '100',
      deliveredAt: '110',
      disputedAt: '0',
      credentialId: h(14),
      deliveryVersion: h(15),
      manifestCommitment: h(16),
      generation: '0',
      termsHash: h(12)
    }
    await t.db.client.escrowProjection.create({
      data: {
        scope,
        chainOrderId: terms.orderId,
        businessOrderId: orderId,
        state: 'Released',
        stockId: terms.stockId,
        amountAtoms: terms.amountAtoms,
        data: state,
        height: 10n,
        blockHash: h(13)
      }
    })
    let clock = new Date('2026-01-01T00:00:00Z')
    p.ledger.now = () => clock
    const terminal = await p.ledger.terminal({
      scope,
      orderId,
      chainOrderId: terms.orderId,
      state: 'Released',
      height: '10',
      blockHash: h(13)
    })
    await t.db.client.privateFileGlobal.create({
      data: { singleton: true, policyHash: 'a'.repeat(64) }
    })
    const version = async (purpose = 'delivery', owner = t.f.seller) => {
      const id = randomUUID(),
        checkId = randomUUID(),
        bytes = Buffer.from('%PDF-1.7 ' + id),
        objectKey = 'objects/' + owner + '/' + id,
        sha256 = createHash('sha256').update(bytes).digest('hex')
      await store.putOnce(objectKey, Readable.from([bytes]), bytes.length, 'application/pdf')
      await t.db.client.privateUpload.create({
        data: {
          id,
          accountId: owner,
          orderId,
          purpose,
          key: id,
          requestHash: 'a'.repeat(64),
          tokenHash: 'b'.repeat(64),
          filename: 'sample.pdf',
          contentType: 'application/pdf',
          declaredBytes: bytes.length,
          actualBytes: bytes.length,
          sha256,
          objectKey,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          status: 'ready',
          checkId
        }
      })
      await t.db.client.privateFileCheck.create({
        data: { id: checkId, uploadId: id, report: { status: 'clean' } }
      })
      const v = await t.db.client.privateFileVersion.create({
        data: {
          uploadId: id,
          orderId,
          ownerId: owner,
          purpose,
          objectKey,
          objectVersion: id,
          sha256,
          byteSize: bytes.length,
          contentType: 'application/pdf',
          filename: 'sample.pdf',
          checkId
        }
      })
      await t.db.client.privateFileQuota.upsert({
        where: { accountId: owner },
        create: { accountId: owner, usedBytes: bytes.length },
        update: { usedBytes: { increment: bytes.length } }
      })
      await t.db.client.privateFileGlobal.update({
        where: { singleton: true },
        data: { usedBytes: { increment: bytes.length } }
      })
      return v
    }
    return {
      ...t,
      p,
      root,
      store,
      scope,
      orderId,
      terms,
      state,
      terminal,
      version,
      now: () => clock,
      clock: (d) => {
        clock = new Date(d)
      },
      async close() {
        await t.close()
        await p.close()
        await rm(root, { recursive: true, force: true })
      }
    }
  } catch (e) {
    await t.close()
    await p.close()
    await rm(root, { recursive: true, force: true })
    throw e
  }
}
