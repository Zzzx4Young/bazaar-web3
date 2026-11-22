import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { sandbox, fixture } from './helpers/database.mjs'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { hashPassword } from '../dist/auth/password.js'
import { PrivateFileService } from '../dist/delivery-files/upload.service.js'
import { GaragePrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { createPrivateUploadGateway } from '../dist/delivery-files/upload-gateway.js'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'
const enabled = Boolean(process.env.PRIVATE_GARAGE_ENDPOINT && process.env.PRIVATE_FILE_CHECK_IMAGE)

test(
  'T05 real Garage + API + independent streaming gateway: large file quarantine, complete check, immutable private version',
  { skip: !enabled },
  async () => {
    const db = await sandbox(),
      f = await fixture(db, 'digital'),
      root = await mkdtemp(join(tmpdir(), 'bazaar-private-garage-flow-'))
    let app, gateway
    try {
      const id = await db.market.create(f.buyer, randomUUID(), f.input)
      await db.client.order.update({ where: { id }, data: { settlementMode: 'testnet_escrow' } })
      const storeConfig = {
        endpoint: process.env.PRIVATE_GARAGE_ENDPOINT,
        bucket: process.env.PRIVATE_GARAGE_BUCKET,
        accessKeyId: process.env.PRIVATE_GARAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.PRIVATE_GARAGE_SECRET_KEY
      }
      const store = new GaragePrivateObjectStore(storeConfig),
        uploadKey = randomBytes(32)
      const budget = {
        globalBytes: 8_000_000_000,
        globalUploads: 8,
        checkConcurrency: 1,
        checkQueue: 4
      }
      const service = new PrivateFileService(db.client, store, budget, uploadKey)
      gateway = createPrivateUploadGateway(service, 'http://localhost:3000')
      await new Promise((done) => gateway.listen(0, '127.0.0.1', done))
      const uploadOrigin = 'http://127.0.0.1:' + gateway.address().port
      const config = readConfig({ DATABASE_URL: db.url.toString() })
      config.privateFiles = {
        uploadOrigin,
        store: storeConfig,
        uploadKey,
        budget,
        checker: {
          image: process.env.PRIVATE_FILE_CHECK_IMAGE,
          memoryBytes: 4_000_000_000,
          cpus: 1,
          pids: 32,
          tmpBytes: 2_200_000_000,
          wallSeconds: 120,
          sudo: true
        },
        scratchRoot: root + '/scratch'
      }
      app = await createApp(config, false)
      const password = 'Virtual-T05-garage-seller-only'
      await db.client.accountCredential.create({
        data: { accountId: f.seller, passwordHash: await hashPassword(password) }
      })
      const seller = await db.client.account.findUniqueOrThrow({ where: { id: f.seller } })
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: config.appOrigin },
        payload: { loginName: seller.loginName, password }
      })
      assert.equal(login.statusCode, 200, login.body)
      const headers = {
        origin: config.appOrigin,
        cookie: login.headers['set-cookie'].split(';')[0],
        'x-csrf-token': login.json().csrfToken,
        'idempotency-key': randomUUID()
      }
      const post = (path, payload = {}, h = headers) =>
        app.inject({ method: 'POST', url: '/api/web3/private-files/' + path, headers: h, payload })
      const file = join(root, 'source.zip')
      execFileSync('python3', [
        '-c',
        `import zipfile,os,sys\nwith zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z:z.writestr('source-fixture.bin',os.urandom(10000000))`,
        file
      ])
      const size = (await stat(file)).size
      const created = await post('upload-intents', {
        orderId: id,
        purpose: 'delivery',
        filename: 'source.zip',
        contentType: 'application/zip',
        byteSize: size
      })
      assert.equal(created.statusCode, 200, created.body)
      const a = created.json()
      assert.equal(a.uploadUrl, uploadOrigin + '/uploads/' + a.uploadId)
      const sent = await fetch(a.uploadUrl, {
        method: 'PUT',
        headers: {
          origin: config.appOrigin,
          authorization: 'Bearer ' + a.uploadToken,
          'content-type': 'application/zip'
        },
        body: createReadStream(file),
        duplex: 'half'
      })
      assert.equal(sent.status, 200, await sent.text())
      const completed = await post(a.uploadId + '/complete')
      assert.equal(completed.statusCode, 200, completed.body)
      assert.equal(completed.json().status, 'quarantined')
      assert.equal(completed.json().downloadEnabled, false)
      const result = await service.checkNext(
        new DockerFileChecker(config.privateFiles.checker),
        root + '/scratch'
      )
      assert.equal(
        result.status,
        'ready',
        JSON.stringify(await db.client.privateFileCheck.findMany())
      )
      const version = await db.client.privateFileVersion.findUniqueOrThrow({
        where: { uploadId: a.uploadId }
      })
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(file)) digest.update(chunk)
      assert.equal(version.sha256, digest.digest('hex'))
      assert.equal(version.byteSize, size)
      assert.equal((await post(a.uploadId + '/status')).json().downloadEnabled, false)
      const anonymous = await fetch(
        storeConfig.endpoint + '/' + storeConfig.bucket + '/' + version.objectKey
      )
      assert.equal(anonymous.status, 403)
      const noDownload = await fetch(a.uploadUrl, { headers: { origin: config.appOrigin } })
      assert.equal(noDownload.status, 405)
      const replay = await fetch(a.uploadUrl, {
        method: 'PUT',
        headers: {
          origin: config.appOrigin,
          authorization: 'Bearer ' + a.uploadToken,
          'content-type': 'application/zip'
        },
        body: Buffer.alloc(100)
      })
      assert.equal(replay.status, 409)
      const noCsrf = { ...headers }
      delete noCsrf['x-csrf-token']
      assert.equal((await post(a.uploadId + '/complete', {}, noCsrf)).statusCode, 403)
      assert.equal((await db.client.privateFileQuota.findFirstOrThrow()).usedBytes, BigInt(size))
      assert.equal((await db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 0n)
      // An oversized multipart attempt remains charged until explicit abort/delete confirmation.
      headers['idempotency-key'] = randomUUID()
      const over = (
        await post('upload-intents', {
          orderId: id,
          purpose: 'evidence',
          filename: 'proof.zip',
          contentType: 'application/zip',
          byteSize: 100
        })
      ).json()
      await assert.rejects(
        service.receive(
          over.uploadId,
          over.uploadToken,
          Readable.from([Buffer.alloc(101)]),
          'application/zip'
        ),
        /INVALID_INPUT/
      )
      assert.equal((await db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 100n)
      await service.cleanupUpload(over.uploadId)
      assert.equal((await db.client.privateFileQuota.findFirstOrThrow()).reservedBytes, 0n)
      if (process.env.PRIVATE_FILE_EVIDENCE_DIR) {
        await writeFile(
          join(process.env.PRIVATE_FILE_EVIDENCE_DIR, 'garage-flow.json'),
          JSON.stringify(
            {
              environment: 'isolated Garage/API/independent streaming gateway',
              orderId: id,
              uploadId: a.uploadId,
              versionId: version.id,
              sha256: version.sha256,
              byteSize: version.byteSize.toString(),
              status: result.status,
              downloadEnabled: false,
              anonymousObjectStatus: anonymous.status,
              gatewayGetStatus: noDownload.status,
              reusedUploadStatus: replay.status,
              missingCsrfStatus: 403,
              oversizeRejectedAndCleaned: true,
              quota: { usedBytes: size, reservedBytes: 0 },
              checks: await db.client.privateFileCheck.findMany()
            },
            (_, value) => (typeof value === 'bigint' ? value.toString() : value),
            2
          ) + '\n',
          { mode: 0o600 }
        )
      }
    } finally {
      if (app) await app.close()
      if (gateway) {
        gateway.closeAllConnections()
        await new Promise((done) => gateway.close(done))
      }
      await db.close()
      await rm(root, { recursive: true, force: true })
    }
  }
)
