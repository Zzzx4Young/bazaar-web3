import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { testnetFixture } from './helpers/testnet.mjs'
import { LocalPrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { chainScope, deploymentDigest, lockChain } from '../dist/web3/escrow-projector.js'
import { transact } from '../dist/database/transaction.js'
const h = (n) => '0x' + n.toString(16).padStart(64, '0')
const module = await import('../dist/delivery-files/delivery-permit.service.js').catch(() => ({}))
const downloads = await import('../dist/delivery-files/download.service.js').catch(() => ({}))
const supplements = await import('../dist/delivery-files/supplement-publication.service.js').catch(
  () => ({})
)

async function deliveryFixture(chain) {
  assert.equal(
    typeof module.DeliveryPermitService,
    'function',
    'T08 delivery permit service is required'
  )
  const t = await testnetFixture(chain?.config)
  const root = await mkdtemp(join(tmpdir(), 'bazaar-t08-'))
  try {
    const wallet = chain?.seller ?? t.w
    if (chain) Object.assign(t.config, chain.config)
    await t.bind(wallet)
    if (chain) {
      const c = await t.challenge('payout', wallet)
      await t.payout.confirmSellerPayout(t.user, c.id, await wallet.signTypedData(c.typedData))
    } else await t.confirm()
    await t.price('1.000001')
    const orderId = await t.create(),
      intentId = randomUUID()
    const deployment = {
      deploymentBlock: '0',
      escrowCodeHash: h(1),
      tokenCodeHash: h(2),
      administrator: '0x' + '3'.repeat(40),
      arbitrator: '0x' + '4'.repeat(40)
    }
    const config = { ...t.config, chainDeployment: chain?.deployment ?? deployment }
    const terms = {
      orderId: h(10),
      stockId: h(20),
      stockGeneration: '0',
      previousOrderId: h(0),
      chainId: config.chainId,
      token: config.token,
      escrow: config.escrow,
      seller: wallet.address.toLowerCase(),
      buyer: chain?.buyer.address.toLowerCase() ?? '0x' + '5'.repeat(40),
      refundAddress: chain?.buyer.address.toLowerCase() ?? '0x' + '5'.repeat(40),
      amountAtoms: '1000001',
      commitmentHash: h(40)
    }
    const termsHash = chain ? chain.orderTermsDigest(terms) : h(40)
    await t.db.client.$transaction(async (tx) => {
      await tx.testnetStock.create({
        data: {
          listingId: t.f.listing.id,
          stockId: h(20),
          previousOrderId: h(0),
          activeOrderId: orderId,
          state: 'protected'
        }
      })
      await tx.paymentOrderTerms.create({
        data: {
          orderId,
          listingId: t.f.listing.id,
          stockId: h(20),
          terms,
          termsHash,
          recoveryEpoch: randomUUID(),
          initialIntentId: intentId
        }
      })
      await tx.paymentIntent.create({
        data: { id: intentId, orderId, permit: terms, digest: h(50) }
      })
    })
    const scope = chainScope(config),
      now = Math.floor(Date.now() / 1000)
    await t.db.client.scanCheckpoint.create({
      data: {
        scope,
        configHash: deploymentDigest(config, config.chainDeployment),
        deploymentBlock: 0n,
        height: 10n,
        hash: h(100),
        status: 'active',
        globals: { paused: false }
      }
    })
    await t.db.client.chainBlock.create({
      data: { scope, height: 10n, hash: h(100), parentHash: h(99), timestamp: BigInt(now) }
    })
    const state = {
      orderId: terms.orderId,
      state: 'Funded',
      buyer: terms.buyer,
      refundAddress: terms.buyer,
      seller: terms.seller,
      amountAtoms: terms.amountAtoms,
      stockId: terms.stockId,
      generation: '0',
      fundedAt: String(now),
      deliveredAt: '0',
      disputedAt: '0',
      credentialId: h(0),
      deliveryVersion: h(0),
      manifestCommitment: h(0),
      termsHash
    }
    await t.db.client.escrowProjection.create({
      data: {
        scope,
        chainOrderId: terms.orderId,
        businessOrderId: orderId,
        state: 'Funded',
        stockId: h(20),
        amountAtoms: '1000001',
        data: state,
        height: 10n,
        blockHash: h(100)
      }
    })
    await t.db.client.chainSnapshot.create({
      data: {
        scope,
        height: 10n,
        hash: h(100),
        ordersHash: 'a'.repeat(64),
        stocksHash: 'b'.repeat(64),
        globals: { paused: false }
      }
    })
    const store = new LocalPrivateObjectStore(root)
    let clock = Date.now()
    const signing = privateKeyToAccount(generatePrivateKey()),
      keyId = h(60)
    const signer = chain
      ? { ...chain.signers.delivery, address: chain.signers.delivery.address.toLowerCase() }
      : {
          keyId,
          address: signing.address.toLowerCase(),
          sign: (p) => signing.signTypedData(module.deliveryTypedData(p, config))
        }
    const observer = chain
      ? new module.ChainDeliverySignerVerifier(
          new (await import('../dist/web3/chain-observer.js')).DualChainObserver(
            config,
            config.chainDeployment
          )
        )
      : {
          async verifySigner() {
            return true
          }
        }
    const permits = new module.DeliveryPermitService(
      t.db.client,
      config,
      store,
      signer,
      observer,
      () => new Date(clock)
    )
    const access = new downloads.DownloadService(
      t.db.client,
      config,
      store,
      'http://127.0.0.1:9999',
      Buffer.alloc(32, 9),
      () => new Date(clock)
    )
    const publication = new supplements.SupplementPublicationService(
      t.db.client,
      config,
      store,
      () => new Date(clock)
    )
    const version = async (purpose = 'delivery', owner = t.f.seller, targetOrder = orderId) => {
      const id = randomUUID(),
        checkId = randomUUID(),
        versionId = randomUUID(),
        bytes = Buffer.from('%PDF-1.7 fixture ' + id)
      const sha256 = createHash('sha256').update(bytes).digest('hex'),
        objectKey = 'objects/' + owner + '/' + id
      await store.putOnce(objectKey, Readable.from([bytes]), bytes.length, 'application/pdf')
      await t.db.client.privateUpload.create({
        data: {
          id,
          accountId: owner,
          orderId: targetOrder,
          purpose,
          key: id,
          requestHash: 'a'.repeat(64),
          tokenHash: 'b'.repeat(64),
          filename: 'document.pdf',
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
        data: {
          id: checkId,
          uploadId: id,
          report: { status: 'clean', structural: true, malware: { clean: true } }
        }
      })
      return t.db.client.privateFileVersion.create({
        data: {
          id: versionId,
          uploadId: id,
          orderId: targetOrder,
          ownerId: owner,
          purpose,
          objectKey,
          objectVersion: id,
          sha256,
          byteSize: bytes.length,
          contentType: 'application/pdf',
          filename: 'document.pdf',
          checkId
        }
      })
    }
    const register = async (p) => {
      Object.assign(state, {
        state: 'Delivered',
        credentialId: p.permit.credentialId,
        deliveryVersion: p.permit.deliveryVersion,
        manifestCommitment: p.permit.manifestCommitment,
        deliveredAt: String(now + 1)
      })
      await t.db.client.escrowProjection.update({
        where: { scope_chainOrderId: { scope, chainOrderId: terms.orderId } },
        data: { state: 'Delivered', data: state }
      })
    }
    const refund = () =>
      transact(t.db.client, async (tx) => {
        await lockChain(tx, scope)
        Object.assign(state, { state: 'Refunded' })
        await tx.escrowProjection.update({
          where: { scope_chainOrderId: { scope, chainOrderId: terms.orderId } },
          data: { state: 'Refunded', data: state }
        })
      })
    return {
      ...t,
      w: wallet,
      root,
      orderId,
      config,
      scope,
      terms,
      store,
      permits,
      access,
      publication,
      version,
      register,
      refund,
      state,
      signer,
      advance: (ms) => {
        clock += ms
      },
      close: async () => {
        await t.close()
        await rm(root, { recursive: true, force: true })
      }
    }
  } catch (e) {
    await t.close()
    await rm(root, { recursive: true, force: true })
    throw e
  }
}

test('T08/A01/A10: reverse registration opens only the exact accepted immutable version', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version()
    const pa = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a'),
      pb = await t.permits.issueDeliveryPermit(t.orderId, b.id, t.f.seller, 'b')
    await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
    await t.register(pa)
    await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
    await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.other), /FORBIDDEN/)
    const link = await t.access.authorizeDownload(t.orderId, a.id, t.f.buyer)
    assert.equal(new Date(link.expiresAt).getTime() - link.issuedAt, 300000)
    assert.match(link.url, /^http:\/\/127\.0\.0\.1:9999\/downloads\//)
    const response = await t.access.readCapability(link.id, link.token)
    assert.equal(response.filename, a.filename)
    assert.equal(
      (await Readable.from(response.body).toArray()).map((x) => x.toString()).join(''),
      '%PDF-1.7 fixture ' + a.uploadId
    )
    assert.notEqual(pa.permit.deliveryVersion, pb.permit.deliveryVersion)
    const original = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    assert.deepEqual(original, pa)
  } finally {
    await t.close()
  }
})

test('T08/A11/A27: missing object, signature mapping or mismatched commitment fail closed', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    await t.db.client.deliverySignature.deleteMany()
    await assert.rejects(
      t.access.authorizeDownload(t.orderId, a.id, t.f.buyer),
      /FILE_UNAVAILABLE|STATE_CONFLICT/
    )
    const b = await t.version()
    await t.store.deleteAndConfirm(b.objectKey)
    await assert.rejects(
      t.permits.issueDeliveryPermit(t.orderId, b.id, t.f.seller, 'b'),
      /FILE_UNAVAILABLE|STATE_CONFLICT/
    )
    assert.equal(await t.db.client.downloadGrant.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08/A10/A17: supplement requires fixed seller dedicated signature and never changes first registration or deadlines', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const c = await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b')
    const wrong = privateKeyToAccount(generatePrivateKey())
    await assert.rejects(
      t.publication.publishSupplement(
        t.orderId,
        b.id,
        c.id,
        await wrong.signTypedData(c.typedData),
        t.f.seller
      ),
      /FORBIDDEN/
    )
    await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
    const sig = await t.w.signTypedData(c.typedData)
    const result = await t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller)
    assert.deepEqual(
      await t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller),
      result
    )
    const link = await t.access.authorizeDownload(t.orderId, b.id, t.f.buyer)
    assert.ok(link.url)
    const o = await t.db.client.escrowProjection.findFirstOrThrow()
    assert.equal(o.data.credentialId, p.permit.credentialId)
    assert.equal(o.data.deliveredAt, t.state.deliveredAt)
    assert.equal(await t.db.client.supplementPublication.count(), 1)
    await t.refund()
    await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
    assert.deepEqual(
      await t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller),
      result
    )
    assert.ok((await t.access.readCapability(link.id, link.token)).body)
    t.advance(300000)
    await assert.rejects(t.access.readCapability(link.id, link.token), /FORBIDDEN/)
  } finally {
    await t.close()
  }
})

test('T08/A19/A21: same final result refund blocks initial links and supplement publication', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const c = await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b'),
      sig = await t.w.signTypedData(c.typedData)
    await t.refund()
    await assert.rejects(
      t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller),
      /STATE_CONFLICT/
    )
    await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.buyer), /STATE_CONFLICT/)
    assert.equal(await t.db.client.downloadGrant.count(), 0)
    assert.equal(await t.db.client.supplementPublication.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08/A27: published evidence loss, cross-order and mismatched final registration never guess latest', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const c = await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b'),
      sig = await t.w.signTypedData(c.typedData)
    await t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller)
    await t.db.client.supplementPublication.deleteMany()
    await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
    await t.db.client.escrowProjection.update({
      where: { scope_chainOrderId: { scope: t.scope, chainOrderId: t.terms.orderId } },
      data: { data: { ...t.state, manifestCommitment: h(999) } }
    })
    await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.buyer), /FILE_UNAVAILABLE/)
    assert.equal(await t.db.client.downloadGrant.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08/A21: refund transaction actually blocks concurrent new download until complete state is committed', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    let enter, release
    const entered = new Promise((r) => {
        enter = r
      }),
      released = new Promise((r) => {
        release = r
      })
    const refund = transact(t.db.client, async (tx) => {
      await lockChain(tx, t.scope)
      enter()
      await released
      await tx.escrowProjection.update({
        where: { scope_chainOrderId: { scope: t.scope, chainOrderId: t.terms.orderId } },
        data: { state: 'Refunded', data: { ...t.state, state: 'Refunded' } }
      })
    })
    await entered
    const pending = t.access.authorizeDownload(t.orderId, a.id, t.f.buyer)
    const rejected = assert.rejects(pending, /STATE_CONFLICT/)
    try {
      let waited = false
      for (let i = 0; i < 80; i++) {
        const rows = await t.db.client
          .$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()`
        if (rows[0].n > 0) {
          waited = true
          break
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      assert.equal(waited, true, 'download must wait on the actual PostgreSQL advisory lock')
    } finally {
      release()
    }
    await refund
    await rejected
    assert.equal(await t.db.client.downloadGrant.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08/A11: purpose mismatch and corrupt saved signature cannot grant first download', async () => {
  const t = await deliveryFixture()
  try {
    const e = await t.version('evidence', t.f.buyer)
    await assert.rejects(
      t.permits.issueDeliveryPermit(t.orderId, e.id, t.f.seller, 'e'),
      /STATE_CONFLICT/
    )
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    await t.db.client.deliverySignature.update({
      where: {
        mappingId: (
          await t.db.client.deliveryMapping.findFirstOrThrow({
            where: { credentialId: p.permit.credentialId }
          })
        ).id
      },
      data: { signature: '0x' + '0'.repeat(130) }
    })
    await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.buyer), /FILE_UNAVAILABLE/)
  } finally {
    await t.close()
  }
})

test(
  'T08 real local T06 contract: exact second-version registration, finalized first gate, supplement, and refund revocation',
  { timeout: 120000 },
  async () => {
    const { localEscrow } = await import('./helpers/local-escrow.mjs')
    const { DualChainObserver } = await import('../dist/web3/chain-observer.js')
    const { ChainIndexer } = await import('../dist/web3/chain-indexer.js')
    const { encodeFunctionData } = await import('viem')
    const f = await localEscrow()
    let t
    const finalize = async (block) => {
      for (let i = 0; i < 100; i++) {
        const h = await f.publicClient.getBlock({ blockTag: 'finalized' })
        if (h.number >= block) return
        await f.publicClient.request({ method: 'evm_mine', params: [] })
      }
      throw new Error('local finality stalled')
    }
    try {
      t = await deliveryFixture(f)
      await t.db.client.chainSnapshot.deleteMany()
      await t.db.client.escrowProjection.deleteMany()
      await t.db.client.scanCheckpoint.deleteMany()
      await t.db.client.chainBlock.deleteMany()
      const indexer = new ChainIndexer(t.db.client, new DualChainObserver(t.config, f.deployment))
      await indexer.projector.initialize('recovery')
      const pay = await f.paymentPermit({ ...t.terms })
      await f.mintTransfer(f.buyer.address, 1000001n)
      const deposit = await f.deposit(pay)
      await finalize(deposit.blockNumber)
      await indexer.runOnce()
      // Explicit owner acceptance of this entirely seeded disposable private basis.
      // Chain replay deliberately cannot take a recovery checkpoint live itself.
      assert.equal((await t.db.client.escrowProjection.findFirstOrThrow()).holdReason, null)
      assert.equal((await t.db.client.scanCheckpoint.findFirstOrThrow()).status, 'recovering')
      await t.db.client.scanCheckpoint.update({
        where: { scope: t.scope },
        data: { status: 'active' }
      })
      const a = await t.version(),
        b = await t.version()
      const pa = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'first'),
        pb = await t.permits.issueDeliveryPermit(t.orderId, b.id, t.f.seller, 'second')
      await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
      if ((await f.timestamp()) < pb.permit.issuedAt) await f.warpMine(pb.permit.issuedAt)
      const registered = await f.deliver(pb.permit, f.seller, pb.signature)
      await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
      await finalize(registered.blockNumber)
      await indexer.runOnce()
      const chosen = await t.db.client.escrowProjection.findFirstOrThrow()
      assert.equal(chosen.data.credentialId, pb.permit.credentialId)
      assert.notEqual(chosen.data.credentialId, pa.permit.credentialId)
      const oldLink = await t.access.authorizeDownload(t.orderId, b.id, t.f.buyer)
      await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.buyer), /STATE_CONFLICT/)
      const c = await t.publication.createChallenge(t.orderId, a.id, t.f.seller, 'supplement')
      await t.publication.publishSupplement(
        t.orderId,
        a.id,
        c.id,
        await f.seller.signTypedData(c.typedData),
        t.f.seller
      )
      assert.ok((await t.access.authorizeDownload(t.orderId, a.id, t.f.buyer)).url)
      await f.dispute(t.terms.orderId)
      const refund = await f.safeExecute(
        f.deployment.arbitrator,
        f.owners.arbitrator,
        f.config.escrow,
        encodeFunctionData({
          abi: f.abi.escrow,
          functionName: 'resolveDispute',
          args: [t.terms.orderId, true, h(80)]
        })
      )
      await finalize(refund.blockNumber)
      await indexer.runOnce()
      await assert.rejects(t.access.authorizeDownload(t.orderId, b.id, t.f.buyer), /STATE_CONFLICT/)
      assert.ok((await t.access.readCapability(oldLink.id, oldLink.token)).body)
      const final = await t.db.client.escrowProjection.findFirstOrThrow()
      assert.equal(final.state, 'Refunded')
      assert.equal(final.data.deliveredAt, chosen.data.deliveredAt)
      assert.equal(
        (await t.db.client.chainStockProjection.findFirstOrThrow()).status,
        'blocked_registered'
      )
      if (process.env.T08_EVIDENCE_FILE)
        await writeFile(
          process.env.T08_EVIDENCE_FILE,
          JSON.stringify(
            {
              environment:
                'one local Anvil behind two loopback proxies; not independent RPC providers or real Sepolia',
              chainId: t.config.chainId,
              escrow: t.config.escrow,
              token: t.config.token,
              transactions: [deposit, registered, refund].map((x) => ({
                txHash: x.transactionHash,
                blockHash: x.blockHash,
                height: x.blockNumber.toString(),
                status: x.status
              })),
              firstAccepted: {
                versionId: b.id,
                credentialId: pb.permit.credentialId,
                deliveryVersion: pb.permit.deliveryVersion,
                manifestCommitment: pb.permit.manifestCommitment
              },
              supplementVersionId: a.id,
              finalState: final.state,
              originalDeliveredAt: chosen.data.deliveredAt,
              finalDeliveredAt: final.data.deliveredAt,
              finalizedHeight: final.height.toString(),
              finalizedBlockHash: final.blockHash,
              stock: 'blocked_registered',
              newRefundLinksRejected: true,
              oldCapabilityValidBeforeOriginalExpiry: true,
              privateRecovery:
                'explicit owner activation of entirely seeded disposable fixture; not full disaster recovery'
            },
            null,
            2
          ) + '\n'
        )
    } finally {
      if (t) await t.close()
      await f.close()
    }
  }
)

test('T08 HTTP: shared authorization, session/CSRF/Origin guards and attachment-only capability access', async () => {
  const t = await deliveryFixture()
  let app, gateway
  try {
    const { createApp } = await import('../dist/app.js'),
      { readConfig } = await import('../dist/config.js'),
      { hashPassword } = await import('../dist/auth/password.js')
    const { createPrivateUploadGateway } = await import('../dist/delivery-files/upload-gateway.js')
    const config = readConfig({ DATABASE_URL: t.db.url.toString() })
    config.web3 = t.config
    const budget = { globalBytes: 8000000000, globalUploads: 8, checkConcurrency: 1, checkQueue: 4 }
    config.privateFiles = {
      uploadOrigin: 'http://127.0.0.1:9999',
      uploadKey: Buffer.alloc(32, 9),
      budget,
      store: {
        endpoint: 'http://127.0.0.1:1',
        bucket: 'fixture',
        accessKeyId: 'fixture',
        secretAccessKey: 'fixture'
      }
    }
    app = await createApp(config, false, {
      walletLedger: t.security.ledger,
      walletEoaCheck: async () => {},
      privateFiles: { store: t.store, budget, uploadKey: Buffer.alloc(32, 9) }
    })
    await t.db.client.accountCredential.create({
      data: { accountId: t.f.buyer, passwordHash: await hashPassword('Virtual-T08-http-buyer') }
    })
    const buyer = await t.db.client.account.findUniqueOrThrow({ where: { id: t.f.buyer } })
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.appOrigin },
      payload: { loginName: buyer.loginName, password: 'Virtual-T08-http-buyer' }
    })
    assert.equal(login.statusCode, 200, login.body)
    const headers = {
      origin: config.appOrigin,
      cookie: login.headers['set-cookie'].split(';')[0],
      'x-csrf-token': login.json().csrfToken
    }
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const url = '/api/web3/orders/' + t.orderId + '/delivery/download',
      payload = { versionId: a.id }
    const post = (h) => app.inject({ method: 'POST', url, headers: h, payload })
    assert.equal((await post({ ...headers, origin: 'https://evil.invalid' })).statusCode, 403)
    assert.equal((await post({ ...headers, 'x-csrf-token': 'invalid' })).statusCode, 403)
    assert.equal((await post({ ...headers, cookie: '' })).statusCode, 401)
    const link = await post(headers)
    assert.equal(link.statusCode, 200, link.body)
    const capability = link.json()
    gateway = createPrivateUploadGateway({}, config.appOrigin, t.access)
    await new Promise((r) => gateway.listen(0, '127.0.0.1', r))
    const base = 'http://127.0.0.1:' + gateway.address().port,
      path = '/downloads/' + capability.id + '?token=' + capability.token
    const response = await fetch(base + path)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition'), /^attachment;/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(await response.text(), /^%PDF/)
    const cookieAttempt = await fetch(base + path, { headers: { cookie: 'bazaar_session=unused' } })
    assert.equal(cookieAttempt.status, 403)
    await cookieAttempt.text()
    await t.refund()
    assert.equal((await post(headers)).statusCode, 409)
    assert.equal((await fetch(base + path)).status, 200)
    t.advance(600000)
    const expired = await fetch(base + path)
    assert.equal(expired.status, 403)
    await expired.text()
    await t.db.client.session.updateMany({
      where: { accountId: t.f.buyer },
      data: { revokedAt: new Date() }
    })
    assert.equal((await post(headers)).statusCode, 401)
  } finally {
    if (gateway) await new Promise((r) => gateway.close(r))
    if (app) await app.close()
    await t.close()
  }
})

test('T08/A11: object lost after registration prevents new link minting', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    await t.store.deleteAndConfirm(a.objectKey)
    await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.buyer), /FILE_UNAVAILABLE/)
    assert.equal(await t.db.client.downloadGrant.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08/A10/A21: supplement waits for actual refund lock and cannot publish after it', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const c = await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b'),
      sig = await t.w.signTypedData(c.typedData)
    let enter, release
    const entered = new Promise((r) => {
        enter = r
      }),
      released = new Promise((r) => {
        release = r
      })
    const refund = transact(t.db.client, async (tx) => {
      await lockChain(tx, t.scope)
      enter()
      await released
      await tx.escrowProjection.update({
        where: { scope_chainOrderId: { scope: t.scope, chainOrderId: t.terms.orderId } },
        data: { state: 'Refunded', data: { ...t.state, state: 'Refunded' } }
      })
    })
    await entered
    const publishing = t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller)
    const rejected = assert.rejects(publishing, /STATE_CONFLICT/)
    try {
      let waited = false
      for (let i = 0; i < 80; i++) {
        const rows = await t.db.client
          .$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event='advisory' AND datname=current_database()`
        if (rows[0].n > 0) {
          waited = true
          break
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      assert.equal(waited, true)
    } finally {
      release()
    }
    await refund
    await rejected
    assert.equal(await t.db.client.supplementPublication.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08/A17: delivery history reveals exact published versions, keeps original cutoff after refund, and never returns bytes', async () => {
  const t = await deliveryFixture()
  try {
    assert.equal(
      typeof t.access.readDelivery,
      'function',
      'T08 history uses the same safe permission service'
    )
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, b.id, t.f.seller, 'b')
    await t.register(p)
    const before = await t.access.readDelivery(t.orderId, t.f.buyer)
    assert.equal(before.firstVersionId, b.id)
    assert.deepEqual(before.publishedVersionIds, [])
    assert.equal(before.downloadsAvailable, true)
    assert.equal(before.acceptanceDeadline, Number(t.state.deliveredAt) + 604800)
    assert.equal(JSON.stringify(before).includes(a.id), false)
    await assert.rejects(t.access.readDelivery(t.orderId, t.f.other), /FORBIDDEN/)
    await t.refund()
    const after = await t.access.readDelivery(t.orderId, t.f.buyer)
    assert.equal(after.downloadsAvailable, false)
    assert.equal(after.firstVersionId, b.id)
    assert.equal(after.acceptanceDeadline, before.acceptanceDeadline)
    assert.equal(JSON.stringify(after).includes('objectKey'), false)
    assert.equal(JSON.stringify(after).includes('signature'), false)
    assert.equal(await t.db.client.downloadGrant.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08 review P2: a disabled seller cannot revoke the active buyer finalized delivery entitlement', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    await t.db.client.account.update({ where: { id: t.f.seller }, data: { status: 'disabled' } })
    assert.ok((await t.access.authorizeDownload(t.orderId, a.id, t.f.buyer)).url)
    await t.db.client.account.update({ where: { id: t.f.buyer }, data: { status: 'disabled' } })
    await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.buyer), /FORBIDDEN/)
  } finally {
    await t.close()
  }
})

test('T08/A27: missing accepted H manifest prevents links; RPC staleness alone preserves established entitlement', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    await t.db.client.scanCheckpoint.update({
      where: { scope: t.scope },
      data: { updatedAt: new Date(Date.now() - 3600000) }
    })
    assert.ok((await t.access.authorizeDownload(t.orderId, a.id, t.f.buyer)).url)
    await t.db.client.chainSnapshot.deleteMany()
    await assert.rejects(t.access.authorizeDownload(t.orderId, a.id, t.f.buyer), /FILE_UNAVAILABLE/)
    assert.equal(await t.db.client.downloadGrant.count(), 1)
  } finally {
    await t.close()
  }
})

test('T08/A10: current wallet rebind cannot replace the original seller publication signer', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const c = await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b'),
      replacement = privateKeyToAccount(generatePrivateKey())
    await t.bind(replacement)
    await assert.rejects(
      t.publication.publishSupplement(
        t.orderId,
        b.id,
        c.id,
        await replacement.signTypedData(c.typedData),
        t.f.seller
      ),
      /FORBIDDEN/
    )
    await t.publication.publishSupplement(
      t.orderId,
      b.id,
      c.id,
      await t.w.signTypedData(c.typedData),
      t.f.seller
    )
    assert.ok((await t.access.authorizeDownload(t.orderId, b.id, t.f.buyer)).url)
  } finally {
    await t.close()
  }
})
test('T08/A10: exact challenge expiry cannot be renewed through idempotent retries', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const c = await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b'),
      sig = await t.w.signTypedData(c.typedData)
    t.advance(300000)
    assert.deepEqual(await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b'), c)
    await assert.rejects(
      t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller),
      /STATE_CONFLICT/
    )
    assert.equal(await t.db.client.supplementPublication.count(), 0)
  } finally {
    await t.close()
  }
})
test('T08/A10/A27: ready version from another order cannot be registered, published or downloaded', async () => {
  const t = await deliveryFixture()
  try {
    const { fixture } = await import('./helpers/database.mjs'),
      f = await fixture(t.db, 'digital')
    const otherOrder = await t.db.market.create(f.buyer, randomUUID(), f.input),
      foreign = await t.version('delivery', t.f.seller, otherOrder)
    await assert.rejects(
      t.permits.issueDeliveryPermit(t.orderId, foreign.id, t.f.seller, 'foreign'),
      /STATE_CONFLICT/
    )
    const a = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    await assert.rejects(
      t.publication.createChallenge(t.orderId, foreign.id, t.f.seller, 'foreign'),
      /STATE_CONFLICT/
    )
    await assert.rejects(
      t.access.authorizeDownload(t.orderId, foreign.id, t.f.buyer),
      /STATE_CONFLICT/
    )
    assert.equal(await t.db.client.downloadGrant.count(), 0)
  } finally {
    await t.close()
  }
})

test('T08/A27: restored supplement challenge with a valid signature for different order terms is rejected', async () => {
  const t = await deliveryFixture()
  try {
    const a = await t.version(),
      b = await t.version(),
      p = await t.permits.issueDeliveryPermit(t.orderId, a.id, t.f.seller, 'a')
    await t.register(p)
    const c = await t.publication.createChallenge(t.orderId, b.id, t.f.seller, 'b')
    const row = await t.db.client.supplementChallenge.findUniqueOrThrow({ where: { id: c.id } })
    const corrupt = { ...row.message, orderId: h(999) }
    await t.db.client.supplementChallenge.update({
      where: { id: c.id },
      data: { message: corrupt }
    })
    const sig = await t.w.signTypedData(supplements.supplementTypedData(t.config, corrupt))
    await assert.rejects(
      t.publication.publishSupplement(t.orderId, b.id, c.id, sig, t.f.seller),
      /FORBIDDEN|FILE_UNAVAILABLE/
    )
    assert.equal(await t.db.client.supplementPublication.count(), 0)
  } finally {
    await t.close()
  }
})
