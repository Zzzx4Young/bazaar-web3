import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const schemaUrl = new URL('../security-ledger/schema.sql', import.meta.url)
const refundUrl = new URL('../security-ledger/refund-schema.sql', import.meta.url)
const max = (2n ** 256n - 1n).toString()
const hash = digit => '0x' + digit.repeat(64)

test('source: fresh ledger contains the exact standalone additive refund schema', async () => {
  const [fresh, refund] = await Promise.all([readFile(schemaUrl, 'utf8'), readFile(refundUrl, 'utf8')])
  assert.ok(fresh.endsWith(refund), 'fresh provisioning must mirror the standalone schema verbatim')
  assert.match(refund, /CREATE TABLE "PaymentLedgerRefundExit"/)
  assert.doesNotMatch(refund, /IF NOT EXISTS/)
})

async function command(script, file, role, id, secretUrl) {
  const child = spawn(process.execPath, [`scripts/${script}.mjs`, '--confirm-independent-ledger'], {
    env: { ...process.env, WEB3_SECURITY_LEDGER_OWNER_URL_FILE: file,
      WEB3_SECURITY_LEDGER_RUNTIME_ROLE: role, WEB3_SECURITY_LEDGER_ID: id },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', resolve)
    })
    output = output.replaceAll(secretUrl.toString(), '[LEDGER_URL]')
    if (secretUrl.password) output = output.replaceAll(decodeURIComponent(secretUrl.password), '[REDACTED]')
    return { code, output }
  } finally { clearTimeout(timer) }
}

async function fixture() {
  const { connect, testUrl } = await import('./helpers/database.mjs')
  const admin = await connect(testUrl())
  const suffix = randomUUID().replaceAll('-', '')
  const database = `wallet_security_test_${suffix}`, role = `refund_${suffix}`
  const dir = await mkdtemp(join(tmpdir(), 'bazaar-refund-ledger-'))
  let createdDatabase = false, createdRole = false, owner, runtime
  const close = async () => {
    await runtime?.onModuleDestroy()
    await owner?.onModuleDestroy()
    if (createdDatabase) await admin.client.$executeRawUnsafe(`DROP DATABASE "${database}"`)
    if (createdRole) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
    await admin.onModuleDestroy()
    await rm(dir, { recursive: true, force: true })
  }
  try {
    await admin.client.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
    createdDatabase = true
    const password = randomBytes(24).toString('hex')
    await admin.client.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`)
    createdRole = true
    const url = new URL(testUrl())
    url.pathname = `/${database}`
    url.searchParams.set('schema', 'public')
    owner = await connect(url)
    const file = join(dir, 'owner-url'), id = randomUUID(), epoch = randomUUID()
    await writeFile(file, url.toString(), { mode: 0o600 })
    // Deliberately provision the historical schema without the additive table.
    const fresh = await readFile(schemaUrl, 'utf8')
    const old = fresh.split('-- Append-only refund exits')[0]
    for (const statement of old.split(';').filter(s => s.trim()))
      await owner.client.$executeRawUnsafe(statement)
    await owner.client.$executeRaw`INSERT INTO "WalletLedgerMeta" ("ledgerId", "recoveryEpoch") VALUES (${id}::uuid, ${epoch}::uuid)`
    const accountId = randomUUID(), operationId = randomUUID()
    await owner.client.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId", "chainId", "revision") VALUES (${accountId}::uuid, 31337, 19)`
    await owner.client.$executeRaw`INSERT INTO "WalletLedgerEvent" ("operationId", "phase", "payload") VALUES (${operationId}::uuid, 'committed', '{"kept":true}'::jsonb)`
    const intent = randomUUID(), order = randomUUID(), listing = randomUUID()
    await owner.client.$executeRaw`INSERT INTO "PaymentLedgerIntent" ("id", "orderId", "listingId", "stockId", "scope", "digest", "termsHash", "recoveryEpoch", "permit") VALUES (${intent}::uuid, ${order}::uuid, ${listing}::uuid, ${hash('1')}, 'test', ${hash('2')}, ${hash('3')}, ${epoch}::uuid, '{}'::jsonb)`
    const row = { scope: 'test', chainId: 31337, escrow: '0x' + '1'.repeat(40), chainOrderId: hash('4'), orderId: order,
      listingId: listing, stockId: hash('1'), generation: '0', nextGeneration: '1', fundedIntentId: intent,
      recoveryEpoch: epoch, basisHash: 'a'.repeat(64), evidence: {}, refundHeight: '12', refundBlockHash: hash('5'),
      refundTxHash: hash('6'), refundLogIndex: '0', finalizedHeight: '20', finalizedHash: hash('7'), neverRegistered: true }
    const snapshot = async () => {
      const result = {}
      for (const name of ['WalletLedgerMeta', 'WalletLedgerAccount', 'WalletLedgerEvent', 'PaymentLedgerIntent'])
        result[name] = await owner.client.$queryRawUnsafe(`SELECT row_to_json(t) AS row FROM "${name}" t`)
      return result
    }
    return { owner: owner.client, row, id, epoch, role, file, url, close, snapshot,
      upgrade: (ledgerId = id) => command('upgrade-refund-ledger', file, role, ledgerId, url),
      async runtime() {
        if (!runtime) {
          const runtimeUrl = new URL(url)
          runtimeUrl.username = role
          runtimeUrl.password = password
          runtime = await connect(runtimeUrl)
        }
        return runtime.client
      } }
  } catch (error) { await close(); throw error }
}

async function insert(client, row) {
  const keys = Object.keys(row)
  const cast = key => {
    if (['orderId', 'listingId', 'fundedIntentId', 'recoveryEpoch'].includes(key)) return '::uuid'
    if (['refundHeight', 'refundLogIndex', 'finalizedHeight'].includes(key)) return '::bigint'
    if (key === 'chainId') return '::integer'
    if (key === 'evidence') return '::jsonb'
    if (key === 'neverRegistered') return '::boolean'
    return ''
  }
  return client.$executeRawUnsafe(`INSERT INTO "PaymentLedgerRefundExit" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${keys.map((k, i) => `$${i + 1}${cast(k)}`).join(', ')})`,
    ...keys.map(k => k === 'evidence' ? JSON.stringify(row[k]) : row[k]))
}

test('T08-R: missing table fails; additive upgrade and reruns preserve identity, revisions and history; runtime is append-only', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    await assert.rejects(f.owner.$queryRawUnsafe('SELECT * FROM "PaymentLedgerRefundExit"'), /does not exist/)
    let result = await f.upgrade()
    assert.equal(result.code, 0, result.output)
    assert.deepEqual(await f.snapshot(), before)
    const runtime = await f.runtime()
    await insert(runtime, f.row)
    const rows = await runtime.$queryRawUnsafe('SELECT * FROM "PaymentLedgerRefundExit"')
    assert.equal(rows.length, 1)
    assert.ok(rows[0].createdAt instanceof Date)
    for (const sql of ['UPDATE "PaymentLedgerRefundExit" SET "evidence" = \'{}\'::jsonb',
      'DELETE FROM "PaymentLedgerRefundExit"', 'TRUNCATE "PaymentLedgerRefundExit"'])
      await assert.rejects(runtime.$executeRawUnsafe(sql), /permission denied/)
    // A rerun repairs drifted grants and leaves all rows untouched.
    await f.owner.$executeRawUnsafe(`GRANT UPDATE, DELETE ON "PaymentLedgerRefundExit" TO "${f.role}"`)
    result = await f.upgrade()
    assert.equal(result.code, 0, result.output)
    await assert.rejects(runtime.$executeRawUnsafe('DELETE FROM "PaymentLedgerRefundExit"'), /permission denied/)
    assert.deepEqual(await runtime.$queryRawUnsafe('SELECT * FROM "PaymentLedgerRefundExit"'), rows)
    assert.deepEqual(await f.snapshot(), before)
    assert.notEqual((await f.upgrade(randomUUID())).code, 0)
    assert.deepEqual(await f.snapshot(), before)
  } finally { await f.close() }
})

test('T08-R: refund constraints reject noncanonical evidence coordinates, generations and duplicate exits', async () => {
  const f = await fixture()
  try {
    const result = await f.upgrade()
    assert.equal(result.code, 0, result.output)
    for (const patch of [
      { chainId: 0 }, { chainId: -1 }, { escrow: '0x' + 'A'.repeat(40) },
      ...['chainOrderId', 'stockId', 'refundBlockHash', 'refundTxHash', 'finalizedHash'].map(k => ({ [k]: '0x' + 'G'.repeat(64) })),
      { basisHash: 'A'.repeat(64) }, { generation: '-1' }, { generation: '00' }, { generation: '1.0' },
      { generation: max, nextGeneration: (BigInt(max) + 1n).toString() },
      { generation: '0', nextGeneration: '2' }, { nextGeneration: '01' },
      { refundHeight: '-1' }, { refundLogIndex: '-1' }, { finalizedHeight: '11' },
      { neverRegistered: false }, { fundedIntentId: randomUUID() }
    ]) await assert.rejects(insert(f.owner, { ...f.row, ...patch }), /constraint|out of range|too long/i, JSON.stringify(patch))
    await insert(f.owner, f.row)
    for (const patch of [{}, { chainOrderId: hash('8'), refundTxHash: hash('9') },
      { chainOrderId: hash('8'), stockId: hash('9') }])
      await assert.rejects(insert(f.owner, { ...f.row, ...patch }), /unique constraint/)
    await insert(f.owner, { ...f.row, scope: 'boundary', generation: (BigInt(max) - 1n).toString(), nextGeneration: max })
  } finally { await f.close() }
})

test('T08-R: upgrade fails closed for malformed existing tables and leaves ledger history unchanged', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    await f.owner.$executeRawUnsafe('CREATE TABLE "PaymentLedgerRefundExit" ("scope" text)')
    const result = await f.upgrade()
    assert.notEqual(result.code, 0)
    assert.match(result.output, /definition|constraint|malformed/i)
    assert.deepEqual(await f.snapshot(), before)
    await f.owner.$executeRawUnsafe('DROP TABLE "PaymentLedgerRefundExit"')
    assert.equal((await f.upgrade()).code, 0)
    const [{ conname }] = await f.owner.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE conrelid = '"PaymentLedgerRefundExit"'::regclass AND contype = 'c' LIMIT 1`)
    await f.owner.$executeRawUnsafe(`ALTER TABLE "PaymentLedgerRefundExit" DROP CONSTRAINT "${conname}"`)
    assert.notEqual((await f.upgrade()).code, 0)
    assert.deepEqual(await f.snapshot(), before)
  } finally { await f.close() }
})
