import { grantRuntime } from '../scripts/runtime-grants.mjs'
import { grantWalletLedger } from '../scripts/wallet-ledger-grants.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { generateKeyPairSync, randomUUID, randomBytes, sign } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sandbox, fixture } from './helpers/database.mjs'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { hashPassword } from '../dist/auth/password.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { startPublicationDaemon } from '../dist/auth/publication-daemon.js'
import { LocalCheckpointPublicationStore } from '../dist/auth/checkpoint-publication.js'
import { publicationTables } from '../dist/auth/publication-outbox.js'
import { stable } from '../dist/web3/chain-observer.js'
const origin = 'http://localhost:3000',
  password = 'T10-HTTP-synthetic-password'
async function command(cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let error = ''
  child.stderr.on('data', (b) => {
    error += b
  })
  const code = await new Promise((r, j) => {
    child.once('exit', r)
    child.once('error', j)
  })
  assert.equal(code, 0, error)
}
async function readRuntimeHead(path) {
  const c = spawn('sudo', ['-n', 'cat', '--', path], { stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []
  c.stdout.on('data', (b) => chunks.push(b))
  const code = await new Promise((r, j) => {
    c.once('exit', r)
    c.once('error', j)
  })
  assert.equal(code, 0)
  return Buffer.concat(chunks)
}
async function launch(message) {
  const child = spawn(
    'sudo',
    [
      '-n',
      process.execPath,
      new URL('./helpers/publication-api-process.mjs', import.meta.url).pathname
    ],
    { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  child.stderr.on('data', (b) => {
    const text = b.toString()
    if (/^API_CHILD_[A-Z_]+\n?$/.test(text)) console.error(text.trim())
  })
  const lines = createInterface({ input: child.stdout })
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API_START_TIMEOUT')), 15000)
      lines.once('line', (line) => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(line))
        } catch {
          reject(new Error('bad child response'))
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('API child exited'))
      })
      child.once('error', reject)
      child.stdin.write(JSON.stringify(message) + '\n')
    })
    assert.equal(result.type, 'ready', JSON.stringify(result))
    return {
      child,
      lines,
      ...result,
      async close() {
        if (child.exitCode === null && !child.signalCode) {
          const exited = new Promise((r) => child.once('exit', r))
          child.stdin.end()
          await exited
        }
        lines.close()
      }
    }
  } catch (e) {
    child.kill('SIGTERM')
    lines.close()
    throw e
  }
}
test('actual HTTP blocks wallet login, claims and payout when only C2 offchain history remains unknown', async () => {
  const db = await sandbox(),
    security = await isolatedLedger(),
    root = await mkdtemp(join(tmpdir(), 't10-service-api-'))
  let runtime, daemon
  const roles = []
  try {
    await chmod(root, 0o755)
    const f = await fixture(db, 'digital'),
      account = await db.client.account.findUniqueOrThrow({ where: { id: f.buyer } })
    await db.client.accountCredential.create({
      data: { accountId: f.buyer, passwordHash: await hashPassword(password) }
    })
    const authority = generateKeyPairSync('ed25519'),
      publicKeyFile = join(root, 'pin.pem'),
      openingFile = join(root, 'opening.json'),
      publicationFile = join(root, 'runtime.json'),
      witnessDirectory = join(root, 'witness'),
      custody = join(root, 'custody')
    await mkdir(witnessDirectory, { mode: 0o700 })
    await mkdir(custody, { mode: 0o700 })
    await command('sudo', ['-n', 'chown', '65534:65534', witnessDirectory])
    const signerFile = join(custody, 'authority.pem')
    await writeFile(signerFile, authority.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
      mode: 0o600
    })
    await writeFile(publicKeyFile, authority.publicKey.export({ format: 'pem', type: 'spki' }), {
      mode: 0o644
    })
    const publicConfig = {
      environmentId: 'service-local',
      configurationVersion: 'C5',
      walletLedgerId: security.id,
      recoveryRunId: randomUUID(),
      wakeSocket: join(root, 'wake.sock'),
      publicKeyFile,
      openingFile
    }
    await writeFile(publicationFile, JSON.stringify(publicConfig), { mode: 0o644 })
    let openingCheckpointHash = '0'.repeat(64)
    const setOpening = async (state, extra = {}) => {
      const payload = {
        version: 1,
        kind: 'publication-opening',
        environmentId: publicConfig.environmentId,
        configurationVersion: publicConfig.configurationVersion,
        recoveryRunId: publicConfig.recoveryRunId,
        walletLedgerId: security.id,
        checkpointHash: openingCheckpointHash,
        offchainHistory: state,
        ...extra
      }
      await writeFile(
        openingFile,
        JSON.stringify({
          payload,
          signature: sign(
            null,
            Buffer.from('bazaar-publication-opening-v1\n' + stable(payload)),
            authority.privateKey
          ).toString('base64')
        }),
        { mode: 0o644 }
      )
    }
    await setOpening('unknown')
    const urls = []
    for (const [kind, owner, url] of [
      ['business', db.client, db.url],
      ['wallet', security.client, security.url]
    ]) {
      const role =
          'api_' + (kind === 'business' ? 'b' : 'w') + '_' + randomUUID().replaceAll('-', ''),
        rolePassword = randomBytes(24).toString('hex')
      await owner.$executeRawUnsafe(
        `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${rolePassword}'`
      )
      roles.push(role)
      const [{ schema }] = await owner.$queryRaw`SELECT current_schema() AS schema`
      if (kind === 'business') await grantRuntime(owner, schema, role)
      else await grantWalletLedger(owner, schema, role)
      const value = new URL(url)
      value.username = role
      value.password = rolePassword
      urls.push(value.toString())
    }
    const message = {
      databaseUrl: urls[0],
      securityUrl: urls[1],
      publicationFile,
      signerFile,
      parentGid: process.getgid(),
      web3: {
        chainId: 11155111,
        tokenDecimals: 6,
        token: '0x' + '1'.repeat(40),
        escrow: '0x' + '2'.repeat(40),
        rpcPrimary: 'https://one.invalid',
        rpcSecondary: 'https://two.invalid',
        securityLedgerUrl: urls[1],
        securityLedgerId: security.id,
        securityWitnessDirectory: witnessDirectory
      }
    }
    console.error('API_STAGE_START')
    runtime = await launch(message)
    console.error('API_STAGE_READY')
    assert.equal(runtime.uid, 65534)
    assert.equal(runtime.signerReadDenied, true)
    assert.equal(runtime.walletRoleRestricted, true)
    assert.equal(runtime.businessRoleRestricted, true)
    const ownerPublicKeyFile = join(custody, 'pin.pem'),
      encryptionKeyFile = join(custody, 'encryption.key'),
      urlFile = join(custody, 'ledger.url'),
      material = join(custody, 'material'),
      encryptionKey = randomBytes(32)
    await mkdir(material, { mode: 0o700 })
    await writeFile(
      ownerPublicKeyFile,
      authority.publicKey.export({ format: 'pem', type: 'spki' }),
      { mode: 0o600 }
    )
    await writeFile(encryptionKeyFile, encryptionKey, { mode: 0o600 })
    await writeFile(urlFile, security.url.toString(), { mode: 0o600 })
    daemon = await startPublicationDaemon({
      environmentId: publicConfig.environmentId,
      configurationVersion: publicConfig.configurationVersion,
      custodyDirectory: material,
      publicKeyFile: ownerPublicKeyFile,
      privateKeyFile: signerFile,
      encryptionKeyFile,
      ledgerSources: [{ namespace: 'wallet', ledgerId: security.id, urlFile }],
      wakeSocket: publicConfig.wakeSocket,
      wakeSocketMode: 0o660
    })
    const store = new LocalCheckpointPublicationStore({
      environmentId: publicConfig.environmentId,
      configurationVersion: publicConfig.configurationVersion,
      directory: material,
      publicKeyFile: ownerPublicKeyFile,
      privateKeyFile: signerFile,
      encryptionKey
    })
    openingCheckpointHash = (await store.recover()).receipts.at(-1).checkpointHash
    await setOpening('verified')
    const post = async (path, payload = {}, headers = {}) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload)
      })
    console.error('API_STAGE_LOGIN')
    const login = await post('auth/login', { loginName: account.loginName, password })
    assert.equal(login.status, 200)
    const body = await login.json(),
      headers = {
        cookie: login.headers.get('set-cookie').split(';')[0],
        'x-csrf-token': body.csrfToken,
        'idempotency-key': randomUUID()
      }
    assert.equal((await post('auth/wallet/current', {}, headers)).status, 200)
    const C2 = await store.recover(),
      c2head = await readRuntimeHead(join(witnessDirectory, 'head.json'))
    openingCheckpointHash = C2.receipts.at(-1).checkpointHash
    const tables = [
        ...publicationTables.wallet,
        'LedgerPublicationOutbox',
        'LedgerPublicationReceipt'
      ],
      c2rows = {}
    for (const table of tables)
      c2rows[table] = await security.client.$queryRawUnsafe(
        `SELECT to_jsonb(t)::text AS row FROM "${table}" t`
      )
    const wallet = privateKeyToAccount(generatePrivateKey())
    const proof = await post(
      'auth/wallet/reauth/password',
      { purpose: 'bind', address: wallet.address, password },
      headers
    )
    assert.equal(proof.status, 200)
    const challenge = await post(
      'auth/wallet/challenge',
      { purpose: 'bind', address: wallet.address, proofId: (await proof.json()).id },
      headers
    )
    assert.equal(challenge.status, 200)
    const c = await challenge.json(),
      signature = await wallet.signTypedData(c.typedData)
    const bind = await post('auth/wallet/consume', { id: c.id, signature }, headers)
    assert.equal(bind.status, 200)
    const deadline = Date.now() + 6000
    const bindingPublished = async () => {
      const e = (await store.recover()).entries.at(-1)
      return e.records.WalletLedgerAccount.some(
        (r) => JSON.parse(r).address === wallet.address.toLowerCase()
      )
    }
    while (Date.now() < deadline && !(await bindingPublished()))
      await new Promise((r) => setTimeout(r, 40))
    assert.equal(
      await bindingPublished(),
      true,
      'API postcommit wake publishes exact new binding without sixty-second wait'
    )

    console.error('API_STAGE_UNKNOWN')
    await setOpening('unknown')
    for (const [path, payload] of [
      ['auth/session', {}],
      ['auth/wallet/current', {}],
      ['web3/payout/confirm', { id: randomUUID(), signature: '0x' + '1'.repeat(130) }],
      ['web3/orders/' + randomUUID() + '/delivery/download', { versionId: randomUUID() }],
      ['auth/wallet/login/challenge', { address: '0x' + '3'.repeat(40) }],
      ['auth/wallet/reauth/password', { password, purpose: 'bind', address: '0x' + '3'.repeat(40) }]
    ]) {
      const response = await post(path, payload, headers)
      assert.equal(response.status, 503, path)
      assert.equal((await response.json()).code, 'WALLET_UNAVAILABLE')
    }
    assert.equal((await post('health/live')).status, 200)
    assert.equal((await post('health/ready')).status, 503)
    console.error('API_STAGE_RESTART')
    await runtime.close()
    await daemon.close()
    daemon = undefined
    await security.client.$executeRawUnsafe(
      'TRUNCATE ' + tables.map((t) => '"' + t + '"').join(',')
    )
    for (const table of tables)
      for (const row of c2rows[table])
        await security.client.$executeRawUnsafe(
          `INSERT INTO "${table}" SELECT * FROM json_populate_record(NULL::"${table}",$1::json)`,
          row.row
        )
    await command('sudo', [
      '-n',
      'chown',
      '-R',
      `${process.getuid()}:${process.getgid()}`,
      witnessDirectory
    ])
    await writeFile(join(witnessDirectory, 'head.json'), c2head, { mode: 0o600 })
    await command('sudo', ['-n', 'chown', '-R', '65534:65534', witnessDirectory])
    runtime = await launch(message)
    console.error('API_STAGE_RESTARTED')
    assert.equal(
      (await post('auth/wallet/login/challenge', { address: '0x' + '3'.repeat(40) })).status,
      503
    )
    await setOpening('verified', { recoveryRunId: randomUUID() })
    assert.equal((await post('auth/session', {}, headers)).status, 503)
    await writeFile(openingFile, JSON.stringify({ payload: {}, signature: 'invalid' }), {
      mode: 0o644
    })
    assert.equal(
      (await post('auth/wallet/login/challenge', { address: wallet.address })).status,
      503
    )
    await rm(openingFile)
    assert.equal((await post('auth/session', {}, headers)).status, 503)
    await setOpening('unknown')
    await assert.rejects(
      launch({ ...message, publicationFile: undefined }),
      /ISOLATED_API_START_FAILED/
    )
    assert.equal((await post('auth/login', { loginName: account.loginName, password })).status, 503)
    if (process.env.PUBLICATION_SERVICE_EVIDENCE_DIR) {
      await mkdir(process.env.PUBLICATION_SERVICE_EVIDENCE_DIR, { recursive: true, mode: 0o700 })
      await writeFile(
        join(process.env.PUBLICATION_SERVICE_EVIDENCE_DIR, 'api-result.json'),
        JSON.stringify(
          {
            environmentId: publicConfig.environmentId,
            configurationVersion: publicConfig.configurationVersion,
            runtimeUid: runtime.uid,
            signerReadDenied: runtime.signerReadDenied,
            walletRoleRestricted: runtime.walletRoleRestricted,
            businessRoleRestricted: runtime.businessRoleRestricted,
            actualHttp: true,
            actualPostgres: true,
            eoaCheck: 'substitute',
            walletSigner: 'node',
            baselineCheckpointHash: openingCheckpointHash,
            offchainUnknownStatuses: {
              session: 503,
              currentWallet: 503,
              siweChallenge: 503,
              bindReauth: 503,
              payout: 503,
              newDownload: 503,
              live: 200,
              ready: 503
            },
            restartUnknownDenied: true,
            c2LedgerAndWitnessRestored: true,
            businessDatabaseRolledBack: false,
            postcommitWakePublishedExactBinding: true,
            targetsMet: false,
            rpo: null,
            rto: null
          },
          null,
          2
        ) + '\n',
        { mode: 0o600 }
      )
    }
  } finally {
    console.error('API_STAGE_CLEANUP')
    await daemon?.close()
    await runtime?.close()
    const cleanup = new (await import('../dist/database/database.service.js')).DatabaseService(
      security.url.toString()
    )
    await cleanup.onModuleInit()
    try {
      await db.close()
      await security.close()
      for (const role of roles) await cleanup.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    } finally {
      await cleanup.onModuleDestroy()
    }
    await command('sudo', ['-n', 'chown', '-R', `${process.getuid()}:${process.getgid()}`, root])
    await rm(root, { recursive: true, force: true })
  }
})
