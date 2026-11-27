import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile, writeFile, symlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedLedger } from './helpers/wallet-ledger.mjs'
import { PostgresWalletSecurityLedger } from '../dist/auth/postgres-wallet-security-ledger.js'
const implementation = await import('../dist/auth/ledger-witness.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
const change = (t, accountId, n, revision = '0', bindingVersion = 0) => ({
  operationId: randomUUID(),
  operation: 'bind',
  accountId,
  chainId: 11155111,
  expectedRecoveryEpoch: t.epoch,
  expectedRevision: revision,
  expectedBindingVersion: bindingVersion,
  address: '0x' + String(n).repeat(40),
  payout: null,
  requestHash: 'a'.repeat(64)
})
async function fixture() {
  assert.equal(typeof implementation.LedgerWitness, 'function', 'T10 independent witness required')
  const t = await isolatedLedger(),
    root = await mkdtemp(join(tmpdir(), 'bazaar-witness-'))
  const witness = new implementation.LedgerWitness(t.client, t.id, root)
  await witness.initializeFresh()
  implementation.registerLedgerWitness(t.client, witness)
  return {
    ...t,
    root,
    witness,
    async close() {
      await t.close()
      await rm(root, { recursive: true, force: true })
    }
  }
}
async function bind(t, c) {
  await t.ledger.prepare(c)
  return t.ledger.commit(c.operationId)
}

test('T10/A27/A30: ledger rollback cannot restore an old binding or erase permanent ownership', async () => {
  const t = await fixture()
  try {
    const id = randomUUID(),
      one = change(t, id, 1)
    await bind(t, one)
    const old = await t.client.$queryRaw`SELECT * FROM "WalletLedgerAccount"`
    await bind(t, change(t, id, 2, '1', 1))
    assert.equal((await t.ledger.read(id, 11155111)).address, '0x' + '2'.repeat(40))
    // Owner fault injection touches only this invocation's randomly named schema.
    await t.client
      .$executeRaw`UPDATE "WalletLedgerAccount" SET "address"=${old[0].address}, "bindingVersion"=1, "revision"=1 WHERE "accountId"=${id}::uuid`
    await assert.rejects(t.ledger.read(id, 11155111), /WALLET_UNAVAILABLE/)
    await assert.rejects(t.ledger.claimOwner(11155111, one.address), /WALLET_UNAVAILABLE/)
    await assert.rejects(t.ledger.prepare(change(t, randomUUID(), 1)), /WALLET_UNAVAILABLE/)
  } finally {
    await t.close()
  }
})

test('T10/A28: missing, pending, damaged and symlink witness deny reads and writes', async () => {
  const t = await fixture()
  try {
    const path = join(t.root, 'head.json'),
      head = await readFile(path)
    await rm(path)
    await assert.rejects(t.ledger.recoveryEpoch(), /WALLET_UNAVAILABLE/)
    await writeFile(path, head, { mode: 0o600 })
    await writeFile(join(t.root, 'pending.json'), '{}', { mode: 0o600 })
    await assert.rejects(t.ledger.recoveryEpoch(), /WALLET_UNAVAILABLE/)
    await rm(join(t.root, 'pending.json'))
    await writeFile(path, '{"bad":true}')
    await assert.rejects(t.ledger.recoveryEpoch(), /WALLET_UNAVAILABLE/)
    await rm(path)
    await writeFile(join(t.root, 'target'), head, { mode: 0o600 })
    await symlink(join(t.root, 'target'), path)
    await assert.rejects(t.ledger.recoveryEpoch(), /WALLET_UNAVAILABLE/)
    await rm(path)
    await writeFile(path, head, { mode: 0o600 })
    await chmod(t.root, 0o777)
    await assert.rejects(t.ledger.recoveryEpoch(), /WALLET_UNAVAILABLE/)
  } finally {
    await t.close()
  }
})

test('T10: fresh provisioning cannot bless populated or already witnessed history', async () => {
  const t = await fixture()
  try {
    await assert.rejects(t.witness.initializeFresh(), /WALLET_UNAVAILABLE/)
    await bind(t, change(t, randomUUID(), 3))
    const other = await mkdtemp(join(tmpdir(), 'bazaar-witness-new-'))
    try {
      await assert.rejects(
        new implementation.LedgerWitness(t.client, t.id, other).initializeFresh(),
        /WALLET_UNAVAILABLE/
      )
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  } finally {
    await t.close()
  }
})

test('T10: separate journal instances serialize writes; rejected work leaves witness unchanged', async () => {
  const t = await fixture()
  try {
    const other = new PostgresWalletSecurityLedger(t.client, t.id)
    const a = change(t, randomUUID(), 4),
      b = change(t, randomUUID(), 5)
    await Promise.all([t.ledger.prepare(a), other.prepare(b)])
    await Promise.all([t.ledger.commit(a.operationId), other.commit(b.operationId)])
    const before = await readFile(join(t.root, 'head.json'), 'utf8')
    await assert.rejects(other.prepare(change(t, randomUUID(), 4)), /ACCOUNT_LINK_REQUIRED/)
    assert.equal(await readFile(join(t.root, 'head.json'), 'utf8'), before)
    await t.witness.verify()
  } finally {
    await t.close()
  }
})

async function pgTool(url, program, args) {
  const { spawn } = await import('node:child_process')
  const child = spawn(program, args, {
    env: {
      PATH: process.env.PATH,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1)
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let err = ''
  child.stderr.on('data', (b) => {
    if (err.length < 4000) err += b.toString()
  })
  const code = await new Promise((ok, no) => {
    child.on('error', no)
    child.on('exit', ok)
  })
  assert.equal(code, 0, err)
}

test('T10/A27: native old ledger restore is rejected; restoring the matching latest ledger recovers current identity', async () => {
  const t = await fixture()
  try {
    const id = randomUUID(),
      schema = t.url.searchParams.get('schema'),
      old = join(t.root, 'old.dump'),
      latest = join(t.root, 'latest.dump')
    await bind(t, change(t, id, 6))
    await pgTool(t.url, 'pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--schema=' + schema,
      '--file=' + old
    ])
    await bind(t, change(t, id, 7, '1', 1))
    await pgTool(t.url, 'pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--schema=' + schema,
      '--file=' + latest
    ])
    const restore = (path) =>
      pgTool(t.url, 'pg_restore', [
        '--clean',
        '--if-exists',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--schema=' + schema,
        '--dbname=' + t.url.pathname.slice(1),
        path
      ])
    await restore(old)
    await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
    await assert.rejects(
      new PostgresWalletSecurityLedger(t.client, t.id).claimOwner(11155111, '0x' + '7'.repeat(40)),
      /WALLET_UNAVAILABLE/
    )
    await restore(latest)
    await t.witness.verify()
    assert.equal((await t.ledger.read(id, 11155111)).address, '0x' + '7'.repeat(40))
    assert.equal(await t.ledger.claimOwner(11155111, '0x' + '6'.repeat(40)), id)
  } finally {
    await t.close()
  }
})

for (const stage of ['before-commit', 'after-commit'])
  test(
    'T10/A28: actual SIGKILL ' + stage + ' preserves ambiguous receipt and denies recovery',
    async () => {
      const t = await fixture()
      const { fork } = await import('node:child_process')
      let child
      try {
        const c = change(t, randomUUID(), 8)
        child = fork(new URL('./helpers/ledger-witness-process.mjs', import.meta.url), [], {
          env: { PATH: process.env.PATH, TEST_LEDGER_URL: t.url.toString() },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        })
        const reached = new Promise((ok, no) => {
          child.on('message', (m) =>
            m.stage === stage ? ok() : no(new Error(m.error ?? 'wrong checkpoint'))
          )
          child.on('error', no)
          child.on('exit', () => no(new Error('child exited before checkpoint')))
        })
        child.send({ stage, id: t.id, root: t.root, change: c })
        await reached
        const exited = new Promise((ok) => child.once('exit', ok))
        child.kill('SIGKILL')
        await exited
        const rows = await t.client
          .$queryRaw`SELECT "id" FROM "WalletLedgerOperation" WHERE "id"=${c.operationId}::uuid`
        assert.equal(rows.length, stage === 'after-commit' ? 1 : 0)
        const pending = JSON.parse(await readFile(join(t.root, 'pending.json'), 'utf8'))
        assert.notEqual(pending.before.digest, pending.after.digest)
        await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
        // Even an owner knowing the worker exited cannot turn a pending commit into
        // an automatic abort. Remove only this test's lock to test the second gate.
        await rm(join(t.root, 'lock'), { recursive: true })
        await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
      } finally {
        if (child?.exitCode === null && !child.signalCode) child.kill('SIGKILL')
        await t.close()
      }
    }
  )

test('T10: committed response loss is idempotent and witness metadata contains no identity payload', async () => {
  const t = await fixture()
  try {
    const c = change(t, randomUUID(), 9)
    const result = await bind(t, c),
      head = await readFile(join(t.root, 'head.json'), 'utf8')
    assert.deepEqual(await t.ledger.commit(c.operationId), result)
    assert.equal(await readFile(join(t.root, 'head.json'), 'utf8'), head)
    assert.equal(head.includes(c.accountId), false)
    assert.equal(head.includes(c.address), false)
  } finally {
    await t.close()
  }
})

test('T10 review P1: concurrent owner rollback DML is never read as current or resealed', async () => {
  const t = await fixture()
  try {
    const id = randomUUID()
    await bind(t, change(t, id, 1))
    await bind(t, change(t, id, 2, '1', 1))
    const head = await readFile(join(t.root, 'head.json'), 'utf8')
    const result = await t.witness.run(async (tx) => {
      await t.client
        .$executeRaw`UPDATE "WalletLedgerAccount" SET "address"=${'0x' + '1'.repeat(40)},"revision"=1,"bindingVersion"=1 WHERE "accountId"=${id}::uuid`
      const [row] =
        await tx.$queryRaw`SELECT "address" FROM "WalletLedgerAccount" WHERE "accountId"=${id}::uuid`
      return row.address
    })
    assert.equal(result, '0x' + '2'.repeat(40))
    assert.equal(await readFile(join(t.root, 'head.json'), 'utf8'), head)
    await assert.rejects(t.witness.verify(), /WALLET_UNAVAILABLE/)
  } finally {
    await t.close()
  }
})

test('T10 review P2: identical ledger has identical witness under different session timezone settings', async () => {
  const t = await fixture()
  const original = t.client.$transaction.bind(t.client)
  try {
    await bind(t, change(t, randomUUID(), 3))
    const head = await readFile(join(t.root, 'head.json'), 'utf8')
    t.client.$transaction = (work, options) =>
      original(async (tx) => {
        await tx.$queryRaw`SELECT set_config('TimeZone','Pacific/Honolulu',true)`
        return work(tx)
      }, options)
    await t.witness.verify()
    assert.equal(await readFile(join(t.root, 'head.json'), 'utf8'), head)
  } finally {
    t.client.$transaction = original
    await t.close()
  }
})
