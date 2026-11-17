import { isolatedPrivateLedger } from './private-ledger.mjs'
import { browserRecoveryTools } from './browser-recovery.mjs'
import { persistPrivateFinality } from '../../dist/delivery-files/lifecycle-projection.js'
import { URLSearchParams } from 'node:url'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { sandbox, fixture } from './database.mjs'
import { isolatedLedger } from './wallet-ledger.mjs'
import { localEscrow } from './local-escrow.mjs'
import { createApp } from '../../dist/app.js'
import { readConfig } from '../../dist/config.js'
import { hashPassword } from '../../dist/auth/password.js'
import { DualChainObserver } from '../../dist/web3/chain-observer.js'
import { ChainIndexer } from '../../dist/web3/chain-indexer.js'
import { PostgresPaymentJournal } from '../../dist/web3/payment-journal.js'
import { PrivateFileService } from '../../dist/delivery-files/upload.service.js'
import { GaragePrivateObjectStore } from '../../dist/delivery-files/object-store.js'
import { DownloadService } from '../../dist/delivery-files/download.service.js'
import { createPrivateUploadGateway } from '../../dist/delivery-files/upload-gateway.js'
import { DockerFileChecker } from '../../dist/delivery-files/check-worker.js'
export async function unusedPort() {
  const s = createServer()
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  const p = s.address().port
  await new Promise((resolve) => s.close(resolve))
  return p
}
export async function web3BrowserFixture(origin, diagnostics = {}) {
  if (!process.env.PRIVATE_GARAGE_ENDPOINT)
    throw new Error('Run with with-web3-test-db and with-private-file-test wrappers')
  let db, security, chain, app, gateway, root, privateLedger, recovery
  const close = async () => {
    if (gateway) {
      gateway.closeAllConnections?.()
      await new Promise((resolve) => gateway.close(resolve))
    }
    await app?.close()
    await recovery?.close()
    await privateLedger?.close()
    await db?.close()
    await security?.close()
    await chain?.close()
    if (root) await rm(root, { recursive: true, force: true })
  }
  try {
    db = await sandbox()
    root = await mkdtemp(join(tmpdir(), 'bazaar-t10-browser-'))
    if (process.env.T10_RECOVERY === '1') {
      await mkdir(join(root, 'wallet-witness'), { mode: 0o700 })
      privateLedger = await isolatedPrivateLedger()
    }
    security = await isolatedLedger(
      privateLedger ? { witnessDirectory: join(root, 'wallet-witness') } : {}
    )
    chain = await localEscrow()
    await chain.publicClient.request({ method: 'anvil_setBlockTimestampInterval', params: [0] })

    const f = await fixture(db, 'digital', '10', 'USD', 'digital_assets')
    const seed = Object.fromEntries(
      Object.entries(f.listing).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key))
    )
    const second = {
      listing: await db.client.listing.create({ data: { ...seed, title: 'Second digital file' } })
    }
    for (const listingId of [f.listing.id, second.listing.id])
      await db.client.digitalInventory.create({ data: { listingId } })
    const password = 'Virtual-T09-browser-only-' + randomUUID(),
      accounts = {}
    for (const [role, id] of [
      ['seller', f.seller],
      ['buyer', f.buyer]
    ]) {
      const email = `t09-${role}-${randomUUID()}@gmail.com`
      await db.client.account.update({
        where: { id },
        data: { loginName: email, displayName: 'T09 ' + role }
      })
      await db.client.accountCredential.create({
        data: { accountId: id, passwordHash: await hashPassword(password) }
      })
      await db.client.accountIdentity.create({
        data: {
          accountId: id,
          provider: 'google',
          subject: 't09-sub-' + id,
          email,
          verifiedAt: new Date(),
          verificationSource: 'google_oidc'
        }
      })
      accounts[role] = { id, loginName: email, password }
    }
    const cfg = readConfig({
      DATABASE_URL: db.url.toString(),
      APP_ORIGIN: origin,
      GOOGLE_CLIENT_ID: 'test-only-browser-client',
      GOOGLE_CLIENT_SECRET: randomBytes(32).toString('hex')
    })
    cfg.web3 = {
      ...chain.config,
      chainDeployment: chain.deployment,
      securityLedgerUrl: security.url.toString(),
      securityLedgerId: security.id
    }
    const storeConfig = {
      endpoint: process.env.PRIVATE_GARAGE_ENDPOINT,
      bucket: process.env.PRIVATE_GARAGE_BUCKET,
      accessKeyId: process.env.PRIVATE_GARAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.PRIVATE_GARAGE_SECRET_KEY
    }
    const store = new GaragePrivateObjectStore(storeConfig),
      uploadPort = await unusedPort()
    const image =
      process.env.PRIVATE_FILE_CHECK_IMAGE ??
      execFileSync(
        'sudo',
        [
          '-n',
          'docker',
          'image',
          'inspect',
          'bazaar-web3-private-check:t05',
          '--format',
          '{{.Id}}'
        ],
        { encoding: 'utf8' }
      ).trim()
    const budget = { globalBytes: 8000000000, globalUploads: 8, checkConcurrency: 1, checkQueue: 4 }
    cfg.privateFiles = {
      uploadOrigin: `http://localhost:${uploadPort}`,
      store: storeConfig,
      uploadKey: randomBytes(32),
      budget,
      checker: {
        image,
        memoryBytes: 4000000000,
        cpus: 1,
        pids: 32,
        tmpBytes: 64000000,
        wallSeconds: 120,
        sudo: true
      },
      scratchRoot: root + '/scratch'
    }
    const codes = new Map()
    const google = {
      authorizeUrl: ({ state, nonce }) => {
        const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        u.search = new URLSearchParams({
          state,
          nonce,
          redirect_uri: origin + '/api/auth/wallet/reauth/google/callback'
        }).toString()
        return u.toString()
      },
      exchange: async ({ code }) => {
        const id = codes.get(code)
        if (!id) throw new Error('Unknown test provider code')
        codes.delete(code)
        return {
          sub: 't09-sub-' + id,
          email: accounts[id === f.seller ? 'seller' : 'buyer'].loginName,
          name: 'Test provider'
        }
      }
    }
    const observer = new DualChainObserver(cfg.web3, chain.deployment),
      journal = new PostgresPaymentJournal(security.client, security.id)
    app = await createApp(cfg, false, {
      logRequest: diagnostics.logRequest,
      privateLedger: privateLedger?.ledger,
      walletLedger: security.ledger,
      walletGoogleClient: google,
      paymentSigner: chain.paymentSigner,
      deliverySigner: {
        ...chain.signers.delivery,
        address: chain.signers.delivery.address.toLowerCase()
      },
      paymentJournal: journal,
      chainObserver: observer,
      privateFiles: { store, budget, uploadKey: cfg.privateFiles.uploadKey }
    })
    const files = app.get(PrivateFileService),
      downloads = app.get(DownloadService)
    gateway = createPrivateUploadGateway(files, origin, downloads)
    await new Promise((resolve) => gateway.listen(uploadPort, '127.0.0.1', resolve))
    const indexer = new ChainIndexer(
      db.client,
      observer,
      () => journal.assertBusinessBasis(db.client, cfg.web3.chainId + ':' + cfg.web3.escrow),
      (range) => journal.assertResolutions(range, observer),
      undefined,
      privateLedger
        ? persistPrivateFinality(
            privateLedger.ledger,
            chain.config.chainId + ':' + chain.config.escrow
          )
        : undefined
    )
    await indexer.projector.initialize('fresh')
    const sync = async () => {
      const head = await chain.publicClient.getBlockNumber({ cacheTime: 0 })
      for (let i = 0; i < 100; i++) {
        if ((await chain.publicClient.getBlock({ blockTag: 'finalized' })).number >= head) break
        await chain.publicClient.request({ method: 'evm_mine', params: [] })
      }
      const finalized = await chain.publicClient.getBlock({ blockTag: 'finalized' })
      assert.ok(finalized.number >= head)
      await indexer.runOnce()
      return {
        height: finalized.number.toString(),
        hash: finalized.hash,
        timestamp: Number(finalized.timestamp)
      }
    }
    await sync()
    await app.listen(0, '127.0.0.1')
    const backendOrigin = await app.getUrl()
    const checker = new DockerFileChecker(cfg.privateFiles.checker)
    if (privateLedger)
      recovery = await browserRecoveryTools({
        db,
        security,
        privateLedger,
        chain,
        cfg,
        store,
        root,
        apiPort: Number(new URL(backendOrigin).port),
        pause: async () => {
          gateway.closeAllConnections?.()
          await new Promise((r) => gateway.close(r))
          gateway = null
          await app.close()
          app = null
        },
        resume: async (databaseUrl) => {
          app = await createApp({ ...cfg, databaseUrl }, false, {
            logRequest: diagnostics.logRequest,
            privateLedger: privateLedger.ledger,
            walletLedger: security.ledger,
            paymentSigner: chain.paymentSigner,
            deliverySigner: {
              ...chain.signers.delivery,
              address: chain.signers.delivery.address.toLowerCase()
            },
            paymentJournal: journal,
            chainObserver: observer,
            privateFiles: { store, budget, uploadKey: cfg.privateFiles.uploadKey }
          })
          await app.listen(Number(new URL(backendOrigin).port), '127.0.0.1')
          gateway = createPrivateUploadGateway(
            app.get(PrivateFileService),
            origin,
            app.get(DownloadService)
          )
          await new Promise((r) => gateway.listen(uploadPort, '127.0.0.1', r))
        }
      })
    return {
      db,
      recovery,
      security,
      chain,
      app,
      files,
      store,
      cfg,
      accounts,
      listings: [f.listing.id, second.listing.id],
      backendOrigin,
      root,
      sync,
      close,
      checkerImage: image,
      providerCode(accountId) {
        const code = randomUUID()
        codes.set(code, accountId)
        return code
      },
      async check() {
        const result = await files.checkNext(checker, root + '/scratch')
        const report =
          result &&
          (await db.client.privateFileCheck.findFirst({
            where: { uploadId: result.uploadId },
            orderBy: { createdAt: 'desc' }
          }))
        assert.equal(result?.status, 'ready', JSON.stringify(report?.report ?? result))
        return result
      },
      async orderEvidence(orderId) {
        const terms = await db.client.paymentOrderTerms.findUniqueOrThrow({ where: { orderId } })
        const projection = await db.client.escrowProjection.findFirstOrThrow({
          where: { businessOrderId: orderId }
        })
        const versions = await db.client.privateFileVersion.findMany({ where: { orderId } })
        return {
          orderId,
          chainOrderId: terms.terms.orderId,
          state: projection.state,
          finalizedHeight: projection.height.toString(),
          finalizedHash: projection.blockHash,
          versions: versions.map((v) => ({
            versionId: v.id,
            objectVersion: v.objectVersion,
            sha256: v.sha256,
            purpose: v.purpose
          }))
        }
      }
    }
  } catch (e) {
    await close()
    throw e
  }
}
