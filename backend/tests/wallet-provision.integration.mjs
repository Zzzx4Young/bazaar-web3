import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { sandbox, fixture, connect, testUrl } from './helpers/database.mjs'
import { createApp } from '../dist/app.js'
import { readConfig } from '../dist/config.js'
import { hashPassword } from '../dist/auth/password.js'

async function provision(file, role, id, secretUrl, witnessDirectory) {
  const child = spawn(process.execPath, witnessDirectory ? ['scripts/initialize-ledger-witness.mjs','--confirm-empty-independent-ledger'] : ['scripts/provision-wallet-ledger.mjs', '--confirm-independent-ledger'], {
    env: { ...process.env, WEB3_SECURITY_LEDGER_OWNER_URL_FILE: file,
      WEB3_SECURITY_LEDGER_RUNTIME_ROLE: role, WEB3_SECURITY_LEDGER_ID: id, WEB3_SECURITY_WITNESS_DIR:witnessDirectory }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
    return { code, output: output.replaceAll(secretUrl.toString(), '[LEDGER_URL]')
      .replaceAll(decodeURIComponent(secretUrl.password), '[REDACTED]') }
  } finally { clearTimeout(timer) }
}

test('T02: explicit independent ledger provisioning and real runtime connection work without resetting an existing ledger', async () => {
  const db = await sandbox(), admin = await connect(testUrl())
  const suffix = randomUUID().replaceAll('-', ''), database = `wallet_security_test_${suffix}`, role = `wp_${suffix}`
  const dir = await mkdtemp(join(tmpdir(), 'bazaar-wallet-provision-'))
  let createdDatabase = false, createdRole = false, app, security
  try {
    await admin.client.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
    createdDatabase = true
    const rolePassword = randomBytes(24).toString('hex')
    await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${rolePassword}'`)
    createdRole = true
    const ownerUrl = new URL(testUrl())
    ownerUrl.pathname = `/${database}`
    ownerUrl.searchParams.set('schema', 'public')
    const file = join(dir, 'ledger-owner-url'), id = randomUUID()
    await writeFile(file, ownerUrl.toString(), { mode: 0o600 })
    const first = await provision(file, role, id, ownerUrl)
    assert.equal(first.code, 0, first.output)
    security = await connect(ownerUrl)
    const [{ epoch }] = await security.client.$queryRaw`SELECT "recoveryEpoch" AS epoch FROM "WalletLedgerMeta"`
    const repeated = await provision(file, role, randomUUID(), ownerUrl)
    assert.notEqual(repeated.code, 0)
    assert.equal((await security.client.$queryRaw`SELECT "recoveryEpoch" AS epoch FROM "WalletLedgerMeta"`)[0].epoch, epoch)
    const witnessDirectory=join(dir,'witness')
    await mkdir(witnessDirectory,{mode:0o700})
    const initialized=await provision(file,role,id,ownerUrl,witnessDirectory)
    assert.equal(initialized.code,0,initialized.output)
    assert.notEqual((await provision(file,role,id,ownerUrl,witnessDirectory)).code,0)
    const runtimeUrl = new URL(ownerUrl)
    runtimeUrl.username = role
    runtimeUrl.password = rolePassword
    const config = readConfig({ DATABASE_URL: db.url.toString(), APP_ORIGIN: 'http://localhost:3000',
      WEB3_ENABLED: '1', WEB3_CHAIN_ID: '11155111', WEB3_TOKEN_ADDRESS: '0x' + '1'.repeat(40),
      WEB3_ESCROW_ADDRESS: '0x' + '2'.repeat(40), WEB3_RPC_PRIMARY: 'https://one.invalid',
      WEB3_RPC_SECONDARY: 'https://two.invalid', WEB3_SECURITY_LEDGER_URL: runtimeUrl.toString(), WEB3_SECURITY_LEDGER_ID: id, WEB3_SECURITY_WITNESS_DIR:witnessDirectory })
    const f = await fixture(db, 'digital'), password = 'Virtual-provision-wallet-password'
    await db.client.accountCredential.create({ data: { accountId: f.buyer, passwordHash: await hashPassword(password) } })
    const account = await db.client.account.findUniqueOrThrow({ where: { id: f.buyer } })
    await assert.rejects(createApp({...config,web3:{...config.web3,securityWitnessDirectory:undefined}},false),/WEB3_SECURITY_WITNESS_DIR/)
    app = await createApp(config, false, { walletEoaCheck: async () => {} })
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: config.appOrigin },
      payload: { loginName: account.loginName, password } })
    assert.equal(login.statusCode, 200, login.body)
    const current = await app.inject({ method: 'POST', url: '/api/auth/wallet/current', headers: {
      origin: config.appOrigin, cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().csrfToken }, payload: {} })
    assert.equal(current.statusCode, 200, current.body)
    assert.equal(current.json().address, null)
    // The deployed-role HTTP path must consult the witness, not merely the
    // mutable ledgerId/recoveryEpoch values read from the same database.
    await security.client.$executeRaw`UPDATE "WalletLedgerMeta" SET "recoveryEpoch"=${randomUUID()}::uuid`
    const held=await app.inject({method:'POST',url:'/api/auth/wallet/current',headers:{
      origin:config.appOrigin,cookie:login.headers['set-cookie'].split(';')[0],
      'x-csrf-token':login.json().csrfToken},payload:{}})
    assert.equal(held.statusCode,503,held.body)
    assert.equal(held.json().code,'WALLET_UNAVAILABLE')
    await app.close();app=null
    await assert.rejects(createApp(config,false,{walletEoaCheck:async()=>{}}),/WALLET_UNAVAILABLE/)
  } finally {
    if (app) await app.close()
    if (security) await security.onModuleDestroy()
    await db.close()
    if (createdDatabase) await admin.client.$executeRawUnsafe(`DROP DATABASE "${database}"`)
    if (createdRole) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
    await rm(dir, { recursive: true, force: true })
  }
})
