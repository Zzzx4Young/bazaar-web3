import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { connect, sandbox, testUrl } from './helpers/database.mjs'
import { createOwnedDatabase, withTestCleanup } from './helpers/owned-database.mjs'
import { grantWalletLedger } from '../scripts/wallet-ledger-grants.mjs'
import { stable } from '../dist/web3/chain-observer.js'

const childMode = process.argv.includes('--service-entrypoint-child')
const childFile = new URL('./publication-service-entrypoints.integration.mjs', import.meta.url)
  .pathname

// The actual script is imported only after dropping OS credentials. The fetch
// wrapper counts calls and delegates unchanged; no RPC result is substituted.
async function childMain() {
  const input = createInterface({ input: process.stdin })
  const message = await new Promise((resolve) =>
    input.once('line', (line) => resolve(JSON.parse(line)))
  )
  input.close()
  let stage = 'DROP_UID'
  let db
  try {
    if (process.getuid() === 0) {
      process.setgroups([message.parentGid])
      process.setgid(65534)
      process.setuid(65534)
    }
    if (process.getuid() !== 65534) throw new Error('RUNTIME_UID_REQUIRED')
    Object.assign(process.env, message.env)
    if (message.mode === 'initialize') {
      stage = 'READ_CONFIG'
      const { DatabaseService } = await import('../dist/database/database.service.js')
      const { readConfig } = await import('../dist/config.js')
      const { requireLedgerWitness } = await import('../dist/auth/ledger-witness.js')
      const { assertWalletLedgerGrants } = await import('../dist/auth/wallet-ledger-grants.js')
      const config = readConfig(process.env)
      stage = 'CONNECT_ROLE'
      db = new DatabaseService(config.web3.securityLedgerUrl)
      await db.onModuleInit()
      stage = 'CHECK_ROLE_GRANTS'
      await assertWalletLedgerGrants(db.client, true)
      const [role] = await db.client.$queryRaw`SELECT current_user AS name,
        (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
        FROM pg_roles WHERE rolname=current_user) AS privileged,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname=current_schema()
          AND r.rolname=current_user) AS owns_table`
      if (role.privileged || role.owns_table) throw new Error('OWNER_ROLE_FORBIDDEN')
      stage = 'INITIALIZE_WITNESS'
      await requireLedgerWitness(db.client, config.web3).initializeFresh()
      process.stdout.write(
        JSON.stringify({
          type: 'initialized',
          uid: process.getuid(),
          role: role.name,
          nonOwner: true
        }) + '\n'
      )
    } else if (message.mode === 'indexer') {
      stage = 'INDEXER_SCRIPT'
      let rpcCalls = 0
      const realFetch = globalThis.fetch
      globalThis.fetch = (...args) => {
        rpcCalls++
        return realFetch(...args)
      }
      process.argv = [
        process.execPath,
        new URL('../scripts/run-chain-indexer.mjs', import.meta.url).pathname,
        '--once'
      ]
      try {
        await import('../scripts/run-chain-indexer.mjs')
      } finally {
        globalThis.fetch = realFetch
        process.stdout.write(
          JSON.stringify({
            type: 'indexer-exited',
            uid: process.getuid(),
            rpcCalls,
            exitCode: process.exitCode ?? 0
          }) + '\n'
        )
      }
    } else if (message.mode === 'private-initialize' || message.mode === 'lifecycle') {
      stage = 'PRIVATE_CONFIG'
      const { readConfig } = await import('../dist/config.js')
      const { PrivateLifecycleLedger } = await import('../dist/delivery-files/deletion-ledger.js')
      const { DatabaseService } = await import('../dist/database/database.service.js')
      const { runtimePublicationOptions } = await import('../dist/auth/publication-runtime.js')
      const config = readConfig(process.env),
        c = message.lifecycle
      if (message.mode === 'private-initialize') {
        db = new DatabaseService(c.url)
        await db.onModuleInit()
        const ledger = new PrivateLifecycleLedger(
          db.client,
          c.ledgerId,
          c.witnessDirectory,
          undefined,
          undefined,
          runtimePublicationOptions(config.web3.publication, 'private-files', c.ledgerId)
        )
        await ledger.witness.initializeFresh()
        process.stdout.write(
          JSON.stringify({ type: 'private-initialized', uid: process.getuid() }) + '\n'
        )
      } else {
        config.privateLifecycle = { ...c, publication: config.web3.publication }
        config.privateFiles = {
          store: {
            endpoint: 'http://127.0.0.1:1',
            bucket: 'isolated-test',
            accessKeyId: 'synthetic',
            secretAccessKey: 'synthetic'
          }
        }
        stage = 'LIFECYCLE_IMPORT'
        const { lifecycleRuntime } = await import('../scripts/private-lifecycle-runtime.mjs')
        const runtime = await lifecycleRuntime({ config, connectSource: false })
        try {
          await runtime.ledger.append('restore', randomUUID(), { phase: 'local-entrypoint-check' })
          const { RetentionService } = await import('../dist/delivery-files/retention.service.js')
          let normalRetentionDenied = false
          try {
            await new RetentionService(
              runtime.source.client,
              config.web3,
              runtime.store,
              runtime.ledger
            ).eligibility(randomUUID())
          } catch (error) {
            normalRetentionDenied = error.code === 'WALLET_UNAVAILABLE'
          }
          process.stdout.write(
            JSON.stringify({
              type: 'lifecycle-ready',
              uid: process.getuid(),
              publication: runtime.ledger.witness.publication?.environmentId,
              normalRetentionDenied
            }) + '\n'
          )
        } finally {
          await runtime.close()
        }
      }
    } else throw new Error('UNKNOWN_CHILD_MODE')
  } catch (error) {
    // Never print configuration values, database URLs, credentials or stacks.
    process.stderr.write(
      JSON.stringify({
        event: 'entrypoint_child_failed',
        stage,
        code:
          typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code)
            ? error.code
            : 'ENTRYPOINT_CHILD_FAILED'
      }) + '\n'
    )
    process.exitCode = 1
  } finally {
    await db?.onModuleDestroy()
  }
}

async function command(program, args, message, timeout = 15000) {
  const child = spawn(program, args, {
    env: { PATH: process.env.PATH },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = '',
    stderr = '',
    timedOut = false
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeout)
  try {
    const ended = new Promise((resolve, reject) => {
      child.once('exit', (code, signal) => resolve({ code, signal }))
      child.once('error', reject)
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(message ? JSON.stringify(message) + '\n' : undefined)
    return { ...(await ended), stdout, stderr, timedOut }
  } finally {
    clearTimeout(timer)
  }
}
async function privileged(args) {
  const result = await command('sudo', ['-n', ...args])
  assert.equal(result.timedOut, false, 'PRIVILEGED_FIXTURE_TIMEOUT')
  assert.equal(result.code, 0, 'PRIVILEGED_FIXTURE_FAILED')
}
async function launch(mode, env, extra = {}) {
  return command('sudo', ['-n', process.execPath, childFile, '--service-entrypoint-child'], {
    mode,
    env,
    ...extra,
    parentGid: process.getgid()
  })
}

if (childMode) await childMain()
else
  test(
    'actual indexer and lifecycle scripts at UID 65534 preserve publication and unknown-history isolation',
    { timeout: 60000 },
    async () => {
      // testUrl guards the explicitly selected disposable bazaar_test database.
      // The independent ledger gets its own physical random database, because the
      // real script correctly rejects mere schema separation in one database.
      const base = testUrl(),
        admin = await connect(base)
      const suffix = randomUUID().replaceAll('-', '')
      const database = 't10_entry_' + suffix,
        role = 't10_ep_' + suffix
      const root = await mkdtemp(join(tmpdir(), 't10-entrypoint-'))
      let business,
        owner,
        owned,
        createdRole = false,
        privateOwner,
        privateRoleCreated = false
      await withTestCleanup(async () => {
        business = await sandbox(base, false)
        owned = await createOwnedDatabase(admin, database)
        const ownerUrl = new URL(base)
        ownerUrl.pathname = '/' + database
        ownerUrl.searchParams.set('schema', 'public')
        owner = await connect(ownerUrl)
        const sql = await readFile(
          new URL('../security-ledger/schema.sql', import.meta.url),
          'utf8'
        )
        for (const statement of sql.split(';').filter((s) => s.trim()))
          await owner.client.$executeRawUnsafe(statement)
        const ledgerId = randomUUID()
        await owner.client
          .$executeRaw`INSERT INTO "WalletLedgerMeta" ("singleton","ledgerId","recoveryEpoch") VALUES (true,${ledgerId}::uuid,${randomUUID()}::uuid)`
        const password = randomBytes(24).toString('hex')
        await admin.client.$executeRawUnsafe(
          `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`
        )
        createdRole = true
        await grantWalletLedger(owner.client, 'public', role)
        const runtimeUrl = new URL(ownerUrl)
        runtimeUrl.username = role
        runtimeUrl.password = password
        await chmod(root, 0o755)
        const witness = join(root, 'witness')
        await mkdir(witness, { mode: 0o700 })
        await privileged(['chown', '65534:65534', witness])
        const authority = generateKeyPairSync('ed25519')
        const publicKeyFile = join(root, 'public.pem'),
          openingFile = join(root, 'opening.json')
        const publicationFile = join(root, 'publication.json'),
          deploymentFile = join(root, 'deployment.json')
        const runtimeConfig = {
          environmentId: 'entrypoint-local',
          configurationVersion: 'C5',
          walletLedgerId: ledgerId,
          recoveryRunId: randomUUID(),
          wakeSocket: join(root, 'absent-wake.sock'),
          publicKeyFile,
          openingFile
        }
        await writeFile(
          publicKeyFile,
          authority.publicKey.export({ type: 'spki', format: 'pem' }),
          { mode: 0o644 }
        )
        await writeFile(publicationFile, JSON.stringify(runtimeConfig), { mode: 0o644 })
        const payload = {
          version: 1,
          kind: 'publication-opening',
          environmentId: runtimeConfig.environmentId,
          configurationVersion: runtimeConfig.configurationVersion,
          recoveryRunId: runtimeConfig.recoveryRunId,
          walletLedgerId: ledgerId,
          checkpointHash: 'a'.repeat(64),
          offchainHistory: 'unknown'
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
        await writeFile(
          deploymentFile,
          JSON.stringify({
            deploymentBlock: '0',
            escrowCodeHash: '0x' + '1'.repeat(64),
            tokenCodeHash: '0x' + '2'.repeat(64),
            administrator: '0x' + '3'.repeat(40),
            arbitrator: '0x' + '4'.repeat(40)
          }),
          { mode: 0o644 }
        )
        const env = {
          DATABASE_URL: business.url.toString(),
          APP_ORIGIN: 'http://localhost:3000',
          WEB3_ENABLED: '1',
          WEB3_CHAIN_ID: '11155111',
          WEB3_TOKEN_ADDRESS: '0x' + '1'.repeat(40),
          WEB3_ESCROW_ADDRESS: '0x' + '2'.repeat(40),
          WEB3_RPC_PRIMARY: 'https://primary.invalid',
          WEB3_RPC_SECONDARY: 'https://secondary.invalid',
          WEB3_SECURITY_LEDGER_URL: runtimeUrl.toString(),
          WEB3_SECURITY_LEDGER_ID: ledgerId,
          WEB3_SECURITY_WITNESS_DIR: witness,
          WEB3_CHAIN_DEPLOYMENT_FILE: deploymentFile,
          WEB3_PUBLICATION_RUNTIME_CONFIG_FILE: publicationFile
        }
        const initialized = await launch('initialize', env)
        assert.equal(initialized.timedOut, false)
        assert.equal(
          initialized.code,
          0,
          'UID65534_WITNESS_INITIALIZATION_FAILED ' + initialized.stderr
        )
        assert.deepEqual(JSON.parse(initialized.stdout), {
          type: 'initialized',
          uid: 65534,
          role,
          nonOwner: true
        })
        assert.equal(initialized.stderr, '')
        const before = await owner.client
          .$queryRaw`SELECT "sequence","digest","payload" FROM "LedgerPublicationOutbox" ORDER BY "sequence"`
        assert.equal(before.length, 1)
        assert.equal(before[0].payload.environmentId, runtimeConfig.environmentId)
        const result = await launch('indexer', env)
        assert.equal(result.timedOut, false, 'INDEXER_MUST_EXIT_WITHOUT_RPC_TIMEOUT')
        assert.equal(result.code, 1)
        assert.equal(result.signal, null)
        assert.deepEqual(JSON.parse(result.stdout), {
          type: 'indexer-exited',
          uid: 65534,
          rpcCalls: 0,
          exitCode: 1
        })
        assert.deepEqual(
          result.stderr
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line)),
          [{ event: 'publication_opening_isolated', code: 'WALLET_UNAVAILABLE' }]
        )
        assert.deepEqual(
          await owner.client
            .$queryRaw`SELECT "sequence","digest","payload" FROM "LedgerPublicationOutbox" ORDER BY "sequence"`,
          before
        )
        assert.equal(
          (await owner.client.$queryRaw`SELECT * FROM "LedgerPublicationReceipt"`).length,
          0
        )
        // A separate restricted role/schema supplies the actual private-file helper.
        const privateSchema = 'pl_' + suffix,
          privateRole = role + '_p',
          privatePassword = randomBytes(24).toString('hex')
        await owner.client.$executeRawUnsafe(`CREATE SCHEMA "${privateSchema}"`)
        const privateUrl = new URL(ownerUrl)
        privateUrl.searchParams.set('schema', privateSchema)
        privateOwner = await connect(privateUrl)
        const privateSql = await readFile(
          new URL('../private-ledger/schema.sql', import.meta.url),
          'utf8'
        )
        for (const statement of privateSql.split(';').filter((x) => x.trim()))
          await privateOwner.client.$executeRawUnsafe(statement)
        const privateId = randomUUID()
        await privateOwner.client
          .$executeRaw`INSERT INTO "PrivateLedgerMeta" ("ledgerId") VALUES (${privateId}::uuid)`
        await admin.client.$executeRawUnsafe(
          `CREATE ROLE "${privateRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${privatePassword}'`
        )
        privateRoleCreated = true
        await privateOwner.client.$executeRawUnsafe(
          `GRANT USAGE ON SCHEMA "${privateSchema}" TO "${privateRole}"`
        )
        await privateOwner.client.$executeRawUnsafe(
          `GRANT SELECT ON "PrivateLedgerMeta","PrivateLedgerEvent" TO "${privateRole}"`
        )
        await privateOwner.client.$executeRawUnsafe(
          `GRANT INSERT ON "PrivateLedgerEvent" TO "${privateRole}"`
        )
        await privateOwner.client.$executeRawUnsafe(
          `GRANT SELECT,INSERT ON "LedgerPublicationOutbox","LedgerPublicationReceipt" TO "${privateRole}"`
        )
        await privateOwner.client.$executeRawUnsafe(
          `GRANT SELECT ON SEQUENCE "LedgerPublicationFence" TO "${privateRole}"`
        )
        privateUrl.username = privateRole
        privateUrl.password = privatePassword
        const privateWitness = join(root, 'private-witness'),
          sourceFile = join(root, 'backup-url')
        await mkdir(privateWitness, { mode: 0o700 })
        await privileged(['chown', '65534:65534', privateWitness])
        await writeFile(sourceFile, business.url.toString(), { mode: 0o600 })
        await privileged(['chown', '65534:65534', sourceFile])
        runtimeConfig.privateLedgerId = privateId
        await writeFile(publicationFile, JSON.stringify(runtimeConfig), { mode: 0o644 })
        const opening = JSON.parse(await readFile(openingFile, 'utf8'))
        opening.payload.privateLedgerId = privateId
        opening.signature = sign(
          null,
          Buffer.from('bazaar-publication-opening-v1\n' + stable(opening.payload)),
          authority.privateKey
        ).toString('base64')
        await writeFile(openingFile, JSON.stringify(opening), { mode: 0o644 })
        const lifecycle = {
            url: privateUrl.toString(),
            ledgerId: privateId,
            witnessDirectory: privateWitness
          },
          privateEnv = { ...env, PRIVATE_BACKUP_DATABASE_URL_FILE: sourceFile }
        const initPrivate = await launch('private-initialize', privateEnv, { lifecycle })
        assert.equal(initPrivate.code, 0, initPrivate.stderr)
        const lifecycleResult = await launch('lifecycle', privateEnv, { lifecycle })
        assert.equal(lifecycleResult.code, 0, lifecycleResult.stderr)
        assert.deepEqual(JSON.parse(lifecycleResult.stdout), {
          type: 'lifecycle-ready',
          uid: 65534,
          publication: runtimeConfig.environmentId,
          normalRetentionDenied: true
        })
        const rows = await privateOwner.client
          .$queryRaw`SELECT "sequence","payload" FROM "LedgerPublicationOutbox" ORDER BY "sequence"`
        assert.deepEqual(
          rows.map((r) => Number(r.sequence)),
          [0, 1]
        )
        assert.equal(rows[1].payload.namespace, 'private-files')
        assert.equal(JSON.parse(rows[1].payload.records.PrivateLedgerEvent[0]).kind, 'restore')
      }, [
        ['private owner disconnect', async () => privateOwner?.onModuleDestroy()],
        ['wallet owner disconnect', async () => owner?.onModuleDestroy()],
        ['business fixture', async () => business?.close()],
        ['owned entrypoint database', async () => owned?.drop()],
        [
          'owned private role',
          async () => {
            if (privateRoleCreated) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}_p"`)
          }
        ],
        [
          'owned wallet role',
          async () => {
            if (createdRole) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
          }
        ],
        ['admin disconnect', () => admin.onModuleDestroy()],
        [
          'restore directory ownership',
          () => privileged(['chown', '-R', `${process.getuid()}:${process.getgid()}`, root])
        ],
        ['entrypoint directory', () => rm(root, { recursive: true, force: true })]
      ])
    }
  )
