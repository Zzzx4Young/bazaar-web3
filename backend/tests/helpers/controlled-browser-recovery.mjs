import { attachRequestLogChannel } from './request-log-channel.mjs'
import { publishWitnessCheckpoint } from '../../dist/auth/checkpoint-publisher.js'
import { Buffer } from 'node:buffer'
// Owns synthetic isolated recovery resources only. Never reads development .env.
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, randomUUID, sign, createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fork, spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { stable } from '../../dist/web3/chain-observer.js'
import { backupRoleCustody } from '../../dist/auth/recovery-custody.js'
import { LedgerWitness } from '../../dist/auth/ledger-witness.js'
import { PrivateLifecycleLedger } from '../../dist/delivery-files/deletion-ledger.js'
import {
  createWitnessCheckpointGuard,
  readSignedCheckpoint
} from '../../dist/auth/recovery-authority.js'
import { pgChild } from '../../dist/delivery-files/private-backup.js'
import { encryptedPartHash } from '../../dist/delivery-files/backup-crypto.js'
const sha = (v) => createHash('sha256').update(v).digest('hex')
async function dump(url, path) {
  const u = new URL(url),
    p = pgChild(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--schema=' + u.searchParams.get('schema')
      ],
      u
    )
  await pipeline(p.stdout, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
  await p.done
}
// Both the configured endpoint and the exact URL captured from this invocation's
// fixtures must agree. A schema-shaped string alone is not ownership evidence.
export function assertControlledRestoreTarget(value, ownedValue, configuredValue) {
  try {
    const configured = new URL(configuredValue)
    const target = new URL(value)
    const owned = new URL(ownedValue)
    const port = Number(configured.port)
    if (
      !['postgres:', 'postgresql:'].includes(configured.protocol) ||
      configured.hostname !== '127.0.0.1' ||
      !configured.port ||
      port < 1024 ||
      port > 65535 ||
      [5432, 55432, 55433].includes(port) ||
      configured.pathname !== '/bazaar_test' ||
      target.protocol !== configured.protocol ||
      target.host !== configured.host ||
      target.pathname !== configured.pathname ||
      target.username !== configured.username ||
      target.password !== configured.password ||
      target.href !== owned.href ||
      target.searchParams.getAll('schema').length !== 1 ||
      !/^(wl|pl|v2)_[a-f0-9]{32}$/.test(target.searchParams.get('schema'))
    )
      throw new Error()
    return target
  } catch {
    throw new Error('Dedicated isolated restore only')
  }
}
async function restore(url, path, ownedUrl, configuredUrl) {
  const u = assertControlledRestoreTarget(url, ownedUrl, configuredUrl),
    schema = u.searchParams.get('schema')
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
      path
    ],
    u
  )
  p.stdout.resume()
  await p.done
}
async function childResult(child, send) {
  let timer
  try {
    return await new Promise((yes, no) => {
      timer = setTimeout(() => {
        child.kill('SIGTERM')
        no(new Error('Controlled child timeout'))
      }, 60000)
      child.once('error', no)
      child.once('message', (r) =>
        r.ok ? yes(r) : no(new Error('Controlled owner stage: ' + r.stage + ' ' + r.errorCode))
      )
      child.once('exit', (code) => {
        if (code !== 0) no(new Error('Controlled child exited ' + code))
      })
      send()
    })
  } finally {
    clearTimeout(timer)
  }
}
export async function createControlledBrowserRecovery({
  db,
  security,
  privateLedger,
  chain,
  cfg,
  backupRoot,
  backupKey,
  logRequest
}) {
  const configuredUrl = process.env.TEST_DATABASE_URL
  const ownedUrls = new Map([
    ['business', db.url.toString()],
    ['wallet', security.url.toString()],
    ['private', privateLedger.url.toString()]
  ])
  for (const url of ownedUrls.values()) assertControlledRestoreTarget(url, url, configuredUrl)
  const base = await mkdtemp(join(tmpdir(), 'bazaar-t10-controls-')),
    original = join(base, 'original'),
    custody = join(base, 'custody'),
    archives = join(base, 'archives'),
    bundle = join(custody, 'bundle'),
    used = join(custody, 'used')
  const publicRoot = await mkdtemp(join(tmpdir(), 'bazaar-t10-checkpoints-')),
    restoredBase = await mkdtemp(join(tmpdir(), 'bazaar-t10-runtime-')),
    destination = join(restoredBase, 'materials')
  for (const p of [original, custody, archives, bundle, used, destination])
    await mkdir(p, { mode: 0o700 })
  await chmod(publicRoot, 0o755)
  const pair = generateKeyPairSync('ed25519'),
    environmentId = randomUUID(),
    configurationVersion = 'local-C2-' + randomUUID(),
    publicKeyFile = join(publicRoot, 'trusted.pem')
  await writeFile(publicKeyFile, pair.publicKey.export({ format: 'pem', type: 'spki' }), {
    mode: 0o644
  })
  const checkpointSigningKeyFile = join(custody, 'checkpoint-authority.pem')
  await writeFile(
    checkpointSigningKeyFile,
    pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { mode: 0o600 }
  )
  const keyFiles = {},
    keys = {}
  for (const role of ['manifest', 'config', 'access', 'payment', 'delivery', 'ledger-records']) {
    keys[role] = randomBytes(32)
    keyFiles[role] = join(custody, 'wrapping-' + role)
    await writeFile(keyFiles[role], keys[role].toString('hex'), { mode: 0o600 })
  }
  let c1 = {},
    c1Documents = {},
    checkpoints,
    ownerReport,
    runtimeProof,
    runtime,
    owner,
    c1Audit = []
  const doc = async (path, payload) =>
    writeFile(
      path,
      JSON.stringify({
        payload,
        signature: sign(
          null,
          Buffer.from('bazaar-recovery-document-v1\n' + stable(payload)),
          pair.privateKey
        ).toString('base64')
      }),
      { mode: 0o644 }
    )
  return {
    async captureC1(manifest) {
      for (const [name, url, w] of [
        ['business', db.url],
        ['wallet', security.url, security.witness],
        ['private', privateLedger.url, privateLedger.ledger.witness]
      ]) {
        await dump(url, join(archives, name + '-C1.dump'))
        if (w) {
          c1[name] = JSON.parse(await readFile(join(w.directory, 'head.json'), 'utf8'))
          c1Documents[name] = (
            await publishWitnessCheckpoint({
              witness: w,
              environmentId,
              publicDirectory: publicRoot,
              publicKeyFile,
              privateKeyFile: checkpointSigningKeyFile,
              label: name + '-C1'
            })
          ).document
        }
      }
      const material = chain.recoverySignerMaterials()
      await writeFile(join(original, 'payment-signer'), JSON.stringify(material.payment), {
        mode: 0o600
      })
      await writeFile(join(original, 'delivery-signer'), JSON.stringify(material.delivery), {
        mode: 0o600
      })
      const config = JSON.parse(JSON.stringify(cfg))
      config.configurationVersion = configurationVersion
      config.databaseUrl = ''
      config.web3.securityLedgerUrl = ''
      config.web3.controlledRecovery = true
      delete config.privateFiles.uploadKey
      const { accessKeyId, secretAccessKey, ...publicStore } = config.privateFiles.store
      config.privateFiles.store = publicStore
      await writeFile(
        join(original, 'config-runtime'),
        JSON.stringify({
          config,
          securityId: security.id,
          privateId: privateLedger.id,
          walletSource: security.witness.directory,
          privateSource: privateLedger.root,
          backupRoot,
          backupId: manifest.id
        }),
        { mode: 0o600 }
      )
      await writeFile(
        join(original, 'access-runtime'),
        JSON.stringify({
          databaseUrl: db.url.toString(),
          securityUrl: security.url.toString(),
          privateUrl: privateLedger.url.toString(),
          storeCredentials: { accessKeyId, secretAccessKey },
          uploadKeyHex: cfg.privateFiles.uploadKey.toString('hex'),
          backupKeyHex: backupKey.toString('hex')
        }),
        { mode: 0o600 }
      )
    },
    async captureC2() {
      checkpoints = {}
      for (const [name, url, w] of [
        ['wallet', security.url, security.witness, security.id, 'wallet'],
        [
          'private',
          privateLedger.url,
          privateLedger.ledger.witness,
          privateLedger.id,
          'private-files'
        ]
      ]) {
        await w.verify()
        const head = JSON.parse(await readFile(join(w.directory, 'head.json'), 'utf8'))
        await dump(url, join(original, 'ledger-records-' + name))
        assert.deepEqual(JSON.parse(await readFile(join(w.directory, 'head.json'), 'utf8')), head)
        checkpoints[name] = (
          await publishWitnessCheckpoint({
            witness: w,
            environmentId,
            publicDirectory: publicRoot,
            publicKeyFile,
            privateKeyFile: checkpointSigningKeyFile,
            label: name + '-C2'
          })
        ).options
      }
      const walletDescriptor = JSON.parse(
        await readFile(checkpoints.wallet.configurationFile, 'utf8')
      )
      walletDescriptor.pairedPrivateConfigurationFile = checkpoints.private.configurationFile
      await writeFile(checkpoints.wallet.configurationFile, JSON.stringify(walletDescriptor), {
        mode: 0o644
      })
      checkpoints.wallet.pairedPrivateConfigurationFile = checkpoints.private.configurationFile
      assert.ok(
        (await readSignedCheckpoint(checkpoints.private)).payload.head.sequence >
          c1.private.sequence,
        'refund must distinguish C2 from C1'
      )
      const files = [
        ['config', 'runtime'],
        ['access', 'runtime'],
        ['payment', 'signer'],
        ['delivery', 'signer'],
        ['ledger-records', 'wallet'],
        ['ledger-records', 'private']
      ].map(([role, name]) => ({
        role,
        name,
        source: join(original, role + '-' + name),
        keyId: configurationVersion + ':' + role
      }))
      await backupRoleCustody({
        directory: bundle,
        files,
        keys,
        binding: { environmentId, configurationVersion }
      })
      for (const key of Object.values(keys)) key.fill(0)
    },
    async restore({ targetDatabaseName, apiPort, uploadPort }) {
      c1Audit = await db.client.fileAccessAudit.findMany({
        select: { id: true, orderId: true, action: true, createdAt: true }
      })
      // Fault injection uses saved C1 records, never manufactures database history.
      for (const [name, url] of [
        ['business', db.url],
        ['wallet', security.url],
        ['private', privateLedger.url]
      ])
        await restore(url, join(archives, name + '-C1.dump'), ownedUrls.get(name), configuredUrl)
      await writeFile(join(security.witness.directory, 'head.json'), JSON.stringify(c1.wallet), {
        mode: 0o600
      })
      await writeFile(join(privateLedger.root, 'head.json'), JSON.stringify(c1.private), {
        mode: 0o600
      })
      // Matching rolled-back pairs pass their old local checks; the C2 guard MUST fail.
      await new LedgerWitness(
        privateLedger.db.client,
        privateLedger.id,
        privateLedger.root,
        'private-files'
      ).verify()
      const guarded = new PrivateLifecycleLedger(
        privateLedger.db.client,
        privateLedger.id,
        privateLedger.root,
        undefined,
        createWitnessCheckpointGuard(checkpoints.private, { ownerInspection: true })
      )
      await assert.rejects(guarded.records(), /WALLET_UNAVAILABLE/)
      await chmod(original, 0o000)
      const recoveryId = randomUUID(),
        checkpoint = await readSignedCheckpoint(checkpoints.private),
        authorizationFile = join(custody, 'authorization.json')
      await doc(authorizationFile, {
        version: 1,
        kind: 'recovery-authorization',
        environmentId,
        recoveryId,
        checkpointHash: checkpoint.hash,
        configurationVersion,
        bundleHash: await encryptedPartHash(bundle, 'manifest'),
        targetDirectory: destination,
        nonce: randomUUID(),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString()
      })
      await chmod(authorizationFile, 0o600)
      const authorization = {
        directory: bundle,
        destination,
        checkpoint: checkpoints.private,
        configurationVersion,
        recoveryId,
        authorizationFile,
        publicKeyFile,
        usedDirectory: used
      }
      const inputFile = join(custody, 'owner-input.json')
      await writeFile(
        inputFile,
        JSON.stringify({
          authorization,
          keyFiles,
          checkpoints,
          trustedPublicKeyFile: publicKeyFile,
          checkpointSigningKeyFile,
          publicDirectory: publicRoot,
          originalDirectory: original,
          restoredBase,
          targetDatabaseName,
          apiPort,
          uploadPort
        }),
        { mode: 0o600 }
      )
      owner = fork(new URL('./custody-owner-process.mjs', import.meta.url), [], {
        env: { PATH: process.env.PATH },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      })
      ownerReport = await childResult(owner, () => owner.send({ inputFile }))
      await new Promise((resolve) =>
        owner.exitCode !== null ? resolve() : owner.once('exit', resolve)
      )
      assert.equal(ownerReport.originalReadDenied, true)
      assert.equal(ownerReport.authorizationReplayDenied, true)
      execFileSync('sudo', ['-n', 'chown', '-R', `65534:${process.getgid()}`, restoredBase])
      runtime = spawn(
        'sudo',
        [
          '-n',
          process.execPath,
          fileURLToPath(new URL('./restored-runtime-process.mjs', import.meta.url))
        ],
        { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      runtimeProof = await new Promise((yes, no) => {
        let diagnostic = ''
        const timer = setTimeout(
          () => no(new Error('Recovered runtime timeout ' + diagnostic.slice(-200))),
          45000
        )
        runtime.stderr.on('data', (b) => {
          diagnostic = (diagnostic + b).slice(-1000)
        })
        runtime.once('exit', (code) => {
          clearTimeout(timer)
          no(new Error('Recovered runtime exited ' + code + ' ' + diagnostic.slice(-200)))
        })
        attachRequestLogChannel(runtime.stdout, logRequest, (r) => {
          if (r.ready) {
            clearTimeout(timer)
            yes(r)
          } else if (r.error || r.errorCode) {
            clearTimeout(timer)
            no(new Error('Recovered runtime control failure'))
          }
        }).catch(no)
        runtime.stdin.write(
          JSON.stringify({
            root: restoredBase,
            bootstrapPath: join(restoredBase, 'bootstrap.json'),
            uid: 65534,
            gid: 65534,
            parentGid: process.getgid(),
            originalDirectory: original,
            custodyDirectory: custody,
            trustedPublicKeyFile: publicKeyFile,
            checkpointDirectory: publicRoot,
            trustedProfileFile: ownerReport.trustedProfileFile
          }) + '\n'
        )
      })
      assert.equal(runtimeProof.originalReadDenied, true)
      assert.equal(runtimeProof.custodyWriteDenied, true)
      return ownerReport
    },
    get audits() {
      return c1Audit
    },
    async evidence() {
      return {
        environmentId,
        configurationVersion,
        checkpointC1: c1.private,
        signedCheckpointC1: c1Documents.private,
        publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }),
        signedCheckpointC2: JSON.parse(await readFile(checkpoints.private.checkpointFile, 'utf8')),
        historyC1: JSON.parse(await readFile(join(publicRoot, 'private-C1.history'), 'utf8')),
        historyC2: JSON.parse(await readFile(checkpoints.private.historyFile, 'utf8')),
        checkpointC2: (await readSignedCheckpoint(checkpoints.private)).payload,
        publicKeySha256: sha(pair.publicKey.export({ format: 'pem', type: 'spki' })),
        coRollbackGuardRejected: true,
        owner: ownerReport,
        runtime: runtimeProof,
        allThreeRollbackDetectable: false
      }
    },
    async close() {
      if (runtime && runtime.exitCode === null) {
        runtime.stdin.write(JSON.stringify({ type: 'close' }) + '\n')
        await new Promise((resolve) => {
          const t = setTimeout(() => {
            runtime.kill('SIGTERM')
            resolve()
          }, 5000)
          runtime.once('exit', () => {
            clearTimeout(t)
            resolve()
          })
        })
      }
      if (owner && owner.exitCode === null) owner.kill('SIGTERM')
      execFileSync('sudo', [
        '-n',
        'chown',
        '-R',
        `${process.getuid()}:${process.getgid()}`,
        restoredBase
      ])
      await chmod(original, 0o700)
      for (const p of [base, publicRoot, restoredBase])
        await rm(p, { recursive: true, force: true })
    }
  }
}
